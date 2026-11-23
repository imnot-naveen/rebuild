import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
} from '@nestjs/common';
import { parseLocation, parsePage, parsePositiveQuantity, requiredText } from '../operations/input';
import { OperationsErrorFilter, requireIdempotencyKey } from '../operations/operations-http';
import { AccessClient } from '../requests/access-client';
import { parseStockAdjustment } from './stock-adjustment';
import { StockLotsRepository } from './stock-lots.repository';

@Controller('v1/events/:eventId/stock-lots')
@UseFilters(OperationsErrorFilter)
export class StockLotsController {
  constructor(
    private readonly access: AccessClient,
    private readonly stockLots: StockLotsRepository,
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
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Expected a stock lot object');
    }
    const { category, unit, receivedQuantity, location } = body as Record<string, unknown>;
    return this.stockLots.create(eventId.toLowerCase(), userId, operationKey, {
      category: requiredText(category, 'Category', 64),
      unit: requiredText(unit, 'Unit', 64),
      receivedQuantity: parsePositiveQuantity(receivedQuantity, 'Received quantity'),
      location: parseLocation(location),
    });
  }

  @Get()
  async list(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Headers('authorization') authorization: string | undefined,
    @Query('limit') limit: unknown,
    @Query('cursor') cursor: unknown,
    @Query('category') category: unknown,
  ) {
    await this.access.requireCoordinator(eventId, authorization);
    return this.stockLots.list(
      eventId, parsePage(limit, cursor, 'stock lot'),
      category === undefined ? undefined : requiredText(category, 'Category', 64),
    );
  }

  @Patch(':lotId')
  async adjust(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    const userId = await this.access.requireCoordinator(eventId, authorization);
    return this.stockLots.adjust(
      eventId.toLowerCase(), lotId.toLowerCase(), userId, requireIdempotencyKey(key), parseStockAdjustment(body),
    );
  }

  @Get(':lotId')
  async detail(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Headers('authorization') authorization: string | undefined,
  ) {
    await this.access.requireCoordinator(eventId, authorization);
    const stockLot = await this.stockLots.find(eventId, lotId);
    if (!stockLot) throw new NotFoundException('Stock lot not found');
    return stockLot;
  }
}
