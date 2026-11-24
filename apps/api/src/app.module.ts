import { Controller, Get, Headers, HttpCode, Module } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token';
import { AssignmentsController } from './assignments/assignments.controller';
import { AssignmentsRepository } from './assignments/assignments.repository';
import { MatchSnapshotsRepository } from './matching/match-snapshots.repository';
import { MatchingClient } from './matching/matching-client';
import { OperationsDatabase } from './operations/operations.database';
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

@Module({
  controllers: [HealthController, AuthCheckController, RequestsController, StockLotsController, AssignmentsController],
  providers: [AccessTokenVerifier, AccessClient, OperationsDatabase, RequestsRepository, StockLotsRepository,
    MatchSnapshotsRepository, MatchingClient, AssignmentsRepository],
})
export class AppModule {}
