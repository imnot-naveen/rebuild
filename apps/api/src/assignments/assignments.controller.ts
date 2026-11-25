import {
  BadRequestException, Body, Controller, Get, Header, Headers, NotFoundException,
  Param, ParseUUIDPipe, Post, Query, UseFilters,
} from '@nestjs/common';
import { parsePage } from '../operations/input';
import { OperationsErrorFilter, requireIdempotencyKey } from '../operations/operations-http';
import { AccessClient } from '../requests/access-client';
import { parseAllocation } from '../requests/allocation';
import { RequestsRepository } from '../requests/requests.repository';
import { assignmentStates, AssignmentsRepository } from './assignments.repository';

@Controller('v1/events/:eventId/assignments')
@UseFilters(OperationsErrorFilter)
export class AssignmentsController {
  constructor(
    private readonly access: AccessClient,
    private readonly requests: RequestsRepository,
    private readonly assignments: AssignmentsRepository,
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

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
    @Query('state') state: unknown,
  ) {
    const reader = await this.access.requireAssignmentReader(eventId, authorization);
    const filter = assignmentStates.find((value) => value === state);
    if (state !== undefined && !filter) throw new BadRequestException('Invalid assignment state');
    return this.assignments.list(eventId, reader, parsePage(limit, cursor, 'assignment'), filter);
  }

  @Get(':assignmentId')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    const reader = await this.access.requireAssignmentReader(eventId, authorization);
    const assignment = await this.assignments.find(eventId, assignmentId, reader);
    if (!assignment) throw new NotFoundException('Assignment not found');
    return assignment;
  }
}
