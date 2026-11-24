import { createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

@Injectable()
export class OperationsDatabase implements OnModuleDestroy {
  private readonly connection = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 })
    : undefined;
  private readonly matchingConnection = process.env.DATABASE_URL
    ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      connectionTimeoutMillis: 500,
      statement_timeout: 1500,
    })
    : undefined;

  constructor() {
    const logger = new Logger(OperationsDatabase.name);
    this.connection?.on('error', (error) => logger.error(error.message));
    this.matchingConnection?.on('error', (error) => logger.error(error.message));
  }

  get pool(): Pool {
    if (!this.connection) {
      throw new ServiceUnavailableException('Operations database is unavailable');
    }
    return this.connection;
  }

  get matchingPool(): Pool {
    if (!this.matchingConnection) throw new ServiceUnavailableException('Operations database is unavailable');
    return this.matchingConnection;
  }

  async onModuleDestroy() {
    await Promise.all([this.connection?.end(), this.matchingConnection?.end()]);
  }

  async lockActiveEvent(client: PoolClient, eventId: string) {
    const event = await client.query('SELECT id FROM relief_event WHERE id = $1 AND active FOR SHARE', [eventId]);
    if (event.rowCount === 0) throw new NotFoundException('Active event not found');
  }

  async mutate<T>(
    userId: string, key: string, path: string, input: object, status: 200 | 201,
    write: (client: PoolClient) => Promise<T>,
    { method = 'POST', checkReplay }: {
      method?: 'POST' | 'PATCH';
      checkReplay?: (client: PoolClient) => Promise<void>;
    } = {},
  ): Promise<T> {
    const fingerprint = createHash('sha256').update(JSON.stringify([method, path, input])).digest('hex');
    for (let attempts = 1; ; attempts++) {
      try {
        return await this.runMutation(userId, key, fingerprint, status, write, checkReplay);
      } catch (error) {
        if (typeof error !== 'object' || error === null || !('code' in error) ||
            (error.code !== '40P01' && error.code !== '40001')) {
          throw error;
        }
        if (attempts === 3) {
          throw new ServiceUnavailableException('Database contention prevented the operation. Retry with the same key.');
        }
      }
    }
  }

  private async runMutation<T>(
    userId: string, key: string, fingerprint: string, status: 200 | 201,
    write: (client: PoolClient) => Promise<T>,
    checkReplay?: (client: PoolClient) => Promise<void>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let rollbackError: Error | undefined;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const claim = await client.query(
        `INSERT INTO idempotency_record (actor_id, operation_key, fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (actor_id, operation_key) DO NOTHING`,
        [userId, key, fingerprint],
      );
      if (claim.rowCount === 0) {
        await checkReplay?.(client);
        const result = await client.query<{ fingerprint: string; response_body: T }>(
          `SELECT fingerprint, response_body
             FROM idempotency_record
            WHERE actor_id = $1 AND operation_key = $2`,
          [userId, key],
        );
        const saved = result.rows[0];
        if (saved.fingerprint !== fingerprint) {
          throw new ConflictException('This idempotency key was used for another operation');
        }
        await client.query('COMMIT');
        return saved.response_body;
      }
      const response = await write(client);
      await client.query(
        `UPDATE idempotency_record
            SET response_status = $3, response_body = $4
          WHERE actor_id = $1 AND operation_key = $2`,
        [userId, key, status, response],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (cause) {
        rollbackError = cause instanceof Error ? cause : new Error('Operations transaction rollback failed');
      }
      throw error;
    } finally {
      client.release(rollbackError);
    }
  }
}
