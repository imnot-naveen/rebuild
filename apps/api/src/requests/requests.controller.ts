import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { MatchSnapshotsRepository } from '../matching/match-snapshots.repository';
import { MatchingClient } from '../matching/matching-client';
import { parsePage } from '../operations/input';
import { OperationsErrorFilter, requireIdempotencyKey } from '../operations/operations-http';
import { AccessClient } from './access-client';
import { parseAllocation } from './allocation';
import { parseReport, parseReviewState } from './report';
import { RequestsRepository } from './requests.repository';
import { parseReviewAction, parseReviewCommand, parseUrgency } from './review';

@Controller('v1/events/:eventId/requests')
@UseFilters(OperationsErrorFilter)
export class RequestsController {
  constructor(
    private readonly access: AccessClient,
    private readonly requests: RequestsRepository,
    private readonly matchSnapshots: MatchSnapshotsRepository,
    private readonly matching: MatchingClient,
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
      eventId, reader, parsePage(limit, cursor), parseReviewState(reviewState), parseUrgency(urgency),
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

  @Get(':requestId/matches')
  @Header('Cache-Control', 'no-store')
  async matches(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.requireCoordinator(eventId, authorization);
    const { requestVersion, allocatableQuantity, candidates } = await this.matchSnapshots.read(eventId, requestId);
    return { requestVersion, allocatableQuantity, ...await this.matching.rank({ allocatableQuantity, candidates }) };
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

@Controller('v1/events/:eventId/assignments')
@UseFilters(OperationsErrorFilter)
export class AssignmentsController {
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
    const userId = await this.access.requireCoordinator(eventId, authorization);
    const operationKey = requireIdempotencyKey(key);
    const input = parseAllocation(body);
    const normalizedEvent = eventId.toLowerCase();
    const eligibility = await this.access.volunteerEligibility(normalizedEvent, input.volunteerId);
    return this.requests.allocate(normalizedEvent, userId, operationKey, input, eligibility);
  }
}
