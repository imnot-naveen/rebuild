import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { AccessClient } from './access-client';
import { parseReport, parseRequestPage, parseReviewState } from './report';
import { RequestsRepository } from './requests.repository';
import { parseReviewAction, parseReviewCommand, parseUrgency } from './review';

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

function requireIdempotencyKey(key?: string): string {
  if (!key || !/^[!-+\x2D-~]{1,128}$/.test(key)) {
    throw new BadRequestException('A single Idempotency-Key of 1–128 visible ASCII characters is required');
  }
  return key;
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
    return this.requests.create(eventId.toLowerCase(), userId, requireIdempotencyKey(key), parseReport(body));
  }

  @Post(':requestId/:action')
  @HttpCode(200)
  async review(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Param('action') route: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const action = parseReviewAction(route);
    const userId = action === 'reply'
      ? await this.access.requireResident(eventId, authorization)
      : await this.access.requireCoordinator(eventId, authorization);
    return this.requests.review(
      eventId.toLowerCase(), requestId.toLowerCase(), userId, requireIdempotencyKey(key), route,
      parseReviewCommand(action, body),
    );
  }

  @Get()
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
    @Query('reviewState') reviewState: unknown,
    @Query('urgency') urgency: unknown,
  ) {
    const reader = await this.access.requireRequestReader(eventId, authorization);
    return this.requests.listVisibleRequests(
      eventId, reader, parseRequestPage(limit, cursor), parseReviewState(reviewState), parseUrgency(urgency),
    );
  }

  @Get('access')
  async workspaceAccess(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const { role } = await this.access.requireRequestReader(eventId, authorization);
    return { role };
  }

  @Get(':requestId')
  async detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const reader = await this.access.requireRequestReader(eventId, authorization);
    const request = await this.requests.findVisibleRequest(eventId, requestId, reader);
    if (!request) {
      throw new NotFoundException('Request not found');
    }
    return request;
  }
}
