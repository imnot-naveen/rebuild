import { BadRequestException } from '@nestjs/common';
import { parseLocation, parsePositiveQuantity, requiredText } from '../operations/input';

export function parseStockAdjustment(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a stock adjustment object');
  }
  const fields = body as Record<string, unknown>;
  const version = parsePositiveQuantity(fields.version, 'Stock lot version');
  if (fields.receivedQuantity === undefined && fields.location === undefined) {
    throw new BadRequestException('Enter a received quantity or a location to adjust');
  }
  const quantity = fields.receivedQuantity;
  if (quantity !== undefined &&
      (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 0 || quantity > 2_147_483_647)) {
    throw new BadRequestException('Received quantity must be a nonnegative whole number in the database range');
  }
  return {
    version,
    receivedQuantity: quantity,
    location: fields.location === undefined ? undefined : parseLocation(fields.location),
    reason: quantity === undefined ? undefined : requiredText(fields.reason, 'Adjustment reason', 2000),
  };
}

export type StockAdjustment = ReturnType<typeof parseStockAdjustment>;
