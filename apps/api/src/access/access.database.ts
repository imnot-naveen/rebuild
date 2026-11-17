import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { Pool } from 'pg';

@Injectable()
export class AccessDatabase implements OnModuleDestroy {
  private readonly connection = process.env.ACCESS_DATABASE_URL
    ? new Pool({
      connectionString: process.env.ACCESS_DATABASE_URL,
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
    })
    : undefined;

  constructor() {
    const logger = new Logger(AccessDatabase.name);
    this.connection?.on('error', (error) => logger.error(error.message));
  }

  get pool(): Pool {
    if (!this.connection) {
      throw new ServiceUnavailableException('Access database is unavailable');
    }
    return this.connection;
  }

  async onModuleDestroy() {
    await this.connection?.end();
  }
}
