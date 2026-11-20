import { BadRequestException } from '@nestjs/common';
import { parsePositiveQuantity, parseUuid, requiredText } from '../operations/input';

export function parseAllocation(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected an assignment object');
  }
  const fields = body as Record<string, unknown>;
  return {
    requestId: parseUuid(fields.requestId, 'A valid request ID is required'),
    requestVersion: parsePositiveQuantity(fields.requestVersion, 'Request version'),
    lotId: parseUuid(fields.lotId, 'A valid stock lot ID is required'),
    volunteerId: parseUuid(fields.volunteerId, 'A valid volunteer ID is required'),
    quantity: parsePositiveQuantity(fields.quantity),
    instructions: fields.instructions === undefined ? undefined : requiredText(fields.instructions, 'Instructions', 2000),
  };
}

export type AllocationInput = ReturnType<typeof parseAllocation>;
