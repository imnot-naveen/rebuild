import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ReportInput, RequestDetail, RequestSummary } from './report';

type RequestDetailRow = Omit<RequestDetail, 'createdAt' | 'location'> & {
  createdAt: Date;
  latitude: number;
  longitude: number;
};

@Injectable()
export class RequestsRepository implements OnModuleDestroy {
  private readonly connection = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 })
    : undefined;

  constructor() {
    const logger = new Logger(RequestsRepository.name);
    this.connection?.on('error', (error) => logger.error(error.message));
  }

  private get pool(): Pool {
    if (!this.connection) {
      throw new ServiceUnavailableException('Operations database is unavailable');
    }
    return this.connection;
  }

  async onModuleDestroy() {
    await this.connection?.end();
  }

  async create(eventId: string, userId: string, key: string, input: ReportInput): Promise<RequestSummary> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(['POST', `/v1/events/${eventId}/requests`, input]))
      .digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const claim = await client.query(
        `INSERT INTO idempotency_record (actor_id, operation_key, fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (actor_id, operation_key) DO NOTHING`,
        [userId, key, fingerprint],
      );
      if (claim.rowCount === 0) {
        const result = await client.query<{ fingerprint: string; response_body: RequestSummary }>(
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

      const event = await client.query(
        'SELECT id FROM relief_event WHERE id = $1 AND active FOR SHARE',
        [eventId],
      );
      if (event.rowCount === 0) {
        throw new NotFoundException('Active event not found');
      }

      const category = await client.query(
        'SELECT code FROM category WHERE code = $1 AND unit = $2 FOR SHARE',
        [input.category, input.unit],
      );
      if (category.rowCount === 0) {
        throw new BadRequestException('Invalid category and unit combination');
      }

      const inserted = await client.query<Omit<RequestSummary, 'createdAt' | 'unit'> & { createdAt: Date }>(
        `INSERT INTO assistance_request (
           event_id, resident_id, category_code, requested_quantity, description, location
         )
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         RETURNING id, category_code AS category, requested_quantity AS quantity,
                   review_state AS "reviewState", version, created_at AS "createdAt"`,
        [eventId, userId, input.category, input.quantity, input.description,
          input.location.longitude, input.location.latitude],
      );
      const row = inserted.rows[0];
      const response = { ...row, unit: input.unit, createdAt: row.createdAt.toISOString() };

      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, request_id, operation, review_state)
         VALUES ($1, $2, $3, 'request.create', $4)`,
        [eventId, userId, response.id, response.reviewState],
      );
      await client.query(
        `UPDATE idempotency_record
            SET response_status = 201, response_body = $3
          WHERE actor_id = $1 AND operation_key = $2`,
        [userId, key, response],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findOwnedRequest(
    eventId: string,
    requestId: string,
    userId: string,
  ): Promise<RequestDetail | null> {
    const result = await this.pool.query<RequestDetailRow>(
      `SELECT r.id, r.version, r.description, c.code AS category, c.unit,
              r.requested_quantity AS quantity, r.review_state AS "reviewState",
              r.created_at AS "createdAt",
              ST_Y(r.location::geometry) AS latitude,
              ST_X(r.location::geometry) AS longitude
         FROM assistance_request r
         JOIN category c ON r.category_code = c.code
        WHERE r.id = $1 AND r.event_id = $2 AND r.resident_id = $3`,
      [requestId, eventId, userId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const { createdAt, latitude, longitude, ...fields } = row;

    return {
      ...fields,
      createdAt: createdAt.toISOString(),
      location: { latitude, longitude },
    };
  }
}
