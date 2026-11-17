import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Module,
  Param,
  ParseUUIDPipe,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { AccessTokenVerifier } from '../access-token';
import { AccessDatabase } from './access.database';

@Controller('internal/events/:eventId/actor')
class ActorController {
  private readonly sharedKey = process.env.ACCESS_INTERNAL_KEY?.trim();

  constructor(
    private readonly tokens: AccessTokenVerifier,
    private readonly database: AccessDatabase,
  ) {}

  @Get()
  async resolve(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('x-access-key') key: string | undefined,
    @Headers('authorization') authorization: string | undefined,
  ) {
    if (!this.sharedKey) {
      throw new ServiceUnavailableException('Access is unavailable');
    }
    if (!key || Buffer.byteLength(key) !== Buffer.byteLength(this.sharedKey) ||
        !timingSafeEqual(Buffer.from(key), Buffer.from(this.sharedKey))) {
      throw new NotFoundException();
    }

    const { issuer, subject } = await this.tokens.verifyAuthorization(authorization);
    const result = await this.database.pool.query<{ userId: string; role: string }>(
      `SELECT u.id AS "userId", m.role
         FROM app_user u
         JOIN event_member m ON m.user_id = u.id
        WHERE u.oidc_issuer = $1 AND u.oidc_subject = $2 AND m.event_id = $3`,
      [issuer, subject, eventId],
    );
    const actor = result.rows[0];
    if (!actor) {
      throw new ForbiddenException('Event membership is required');
    }
    return actor;
  }
}

@Module({ controllers: [ActorController], providers: [AccessTokenVerifier, AccessDatabase] })
export class AccessModule {}
