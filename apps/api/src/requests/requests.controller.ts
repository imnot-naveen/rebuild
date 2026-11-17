import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseFilters,
} from '@nestjs/common';
import { AccessClient } from './access-client';
import { parseReport } from './report';
import { RequestsRepository } from './requests.repository';

const errorCodes: Record<number, string> = {
  400: 'invalid_input',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  503: 'service_unavailable',
};

@Catch(HttpException)
class ReportingErrorFilter implements ExceptionFilter<HttpException> {
  catch(error: HttpException, host: ArgumentsHost) {
    const status = error.getStatus();
    const response = host.switchToHttp().getResponse();
    response.status(status).json({ code: errorCodes[status] ?? 'request_failed', message: error.message });
  }
}

@Controller('v1/events/:eventId/requests')
@UseFilters(ReportingErrorFilter)
export class RequestsController {
  constructor(
    private readonly access: AccessClient,
    private readonly requests: RequestsRepository,
  ) {}

  @Post()
  async create(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const userId = await this.access.requireResident(eventId, authorization);
    if (!key || !/^[!-+\x2D-~]{1,128}$/.test(key)) {
      throw new BadRequestException('A single Idempotency-Key of 1–128 visible ASCII characters is required');
    }
    return this.requests.create(eventId.toLowerCase(), userId, key, parseReport(body));
  }

  @Get(':requestId')
  async detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const userId = await this.access.requireResident(eventId, authorization);
    const request = await this.requests.findOwnedRequest(eventId, requestId, userId);
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    return request;
  }
}
