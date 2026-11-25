import { Controller, Get, Header, Headers, HttpCode, Module, Param, ParseUUIDPipe, UseFilters } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token';
import { AssignmentsController } from './assignments/assignments.controller';
import { AssignmentsRepository } from './assignments/assignments.repository';
import { MatchSnapshotsRepository } from './matching/match-snapshots.repository';
import { MatchingClient } from './matching/matching-client';
import { OperationsDatabase } from './operations/operations.database';
import { OperationsErrorFilter } from './operations/operations-http';
import { AccessClient } from './requests/access-client';
import { RequestsController } from './requests/requests.controller';
import { RequestsRepository } from './requests/requests.repository';
import { StockLotsController } from './stock/stock-lots.controller';
import { StockLotsRepository } from './stock/stock-lots.repository';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Controller('auth')
class AuthCheckController {
  constructor(private readonly accessTokens: AccessTokenVerifier) {}

  @Get('check')
  @HttpCode(204)
  async check(@Headers('authorization') authorization?: string): Promise<void> {
    await this.accessTokens.verifyAuthorization(authorization);
  }
}

@Controller('v1/events/:eventId/access')
@UseFilters(OperationsErrorFilter)
class EventAccessController {
  constructor(private readonly access: AccessClient) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async check(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization?: string,
  ) {
    const { role } = await this.access.requireEventMember(eventId, authorization);
    return { role };
  }
}

@Module({
  controllers: [HealthController, AuthCheckController, EventAccessController, RequestsController, StockLotsController,
    AssignmentsController],
  providers: [AccessTokenVerifier, AccessClient, OperationsDatabase, RequestsRepository, StockLotsRepository,
    MatchSnapshotsRepository, MatchingClient, AssignmentsRepository],
})
export class AppModule {}
