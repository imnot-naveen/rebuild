import { Controller, Get, Headers, HttpCode, Module } from '@nestjs/common';
import { AccessTokenVerifier } from './access-token';
import { AccessClient } from './requests/access-client';
import { RequestsController } from './requests/requests.controller';
import { RequestsRepository } from './requests/requests.repository';

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
  controllers: [HealthController, AuthCheckController, RequestsController],
  providers: [AccessTokenVerifier, AccessClient, RequestsRepository],
})
export class AppModule {}
