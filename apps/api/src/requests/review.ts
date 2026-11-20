import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { requiredText } from '../operations/input';
import type { ReviewState } from './report';

export type Urgency = 'routine' | 'urgent' | 'critical';
type SourceType = 'shelter_intake' | 'field_lead';

export type ReviewCommand = { version: number } & (
  | { action: 'clarify' | 'reply'; message: string }
  | { action: 'verify'; quantity: number; urgency: Urgency; sourceType: SourceType; reference: string; rationale: string }
  | { action: 'reject'; message: string; duplicateId?: string }
  | { action: 'link'; relatedId: string }
);

export function nextReviewState(
  action: ReviewCommand['action'],
  current: { reviewState: ReviewState; version: number },
  expectedVersion: number,
): ReviewState {
  if (current.version !== expectedVersion) {
    throw new ConflictException('The request version has changed');
  }
  if (action === 'link') {
    return current.reviewState;
  }
  if (action === 'clarify') {
    if (current.reviewState !== 'submitted') {
      throw new ConflictException('Only submitted requests can be clarified');
    }

    return 'needs_clarification';
  }
  if (action === 'reply') {
    if (current.reviewState !== 'needs_clarification') {
      throw new ConflictException('Only requests awaiting clarification can receive a reply');
    }

    return 'submitted';
  }
  if (current.reviewState !== 'submitted') {
    throw new ConflictException('Only submitted requests can be verified or rejected');
  }
  return action === 'verify' ? 'verified' : 'rejected';
}

export function parseUrgency(value: unknown): Urgency | undefined {
  if (value === undefined || value === 'routine' || value === 'urgent' || value === 'critical') {
    return value;
  }
  throw new BadRequestException('Invalid verified urgency');
}

const actions: ReadonlyMap<string, ReviewCommand['action']> = new Map([
  ['clarifications', 'clarify'],
  ['replies', 'reply'],
  ['verification', 'verify'],
  ['rejection', 'reject'],
  ['related-reports', 'link'],
]);

export function parseReviewAction(route: string): ReviewCommand['action'] {
  const action = actions.get(route);
  if (!action) throw new NotFoundException('Review action not found');
  return action;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new BadRequestException(`${name} must be a positive whole number in the database range`);
  }
  return value;
}

function requestId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('A valid linked request ID is required');
  }
  return value.toLowerCase();
}

export function parseReviewCommand(action: ReviewCommand['action'], body: unknown): ReviewCommand {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a review action object');
  }
  const fields = body as Record<string, unknown>;
  const version = positiveInteger(fields.version, 'Version');
  switch (action) {
    case 'clarify':
      return { action, version, message: requiredText(fields.question, 'Question', 2000) };
    case 'reply':
      return { action, version, message: requiredText(fields.reply, 'Reply', 2000) };
    case 'reject':
      return {
        action, version, message: requiredText(fields.reason, 'Reason', 2000),
        duplicateId: fields.duplicateOfRequestId === undefined ? undefined : requestId(fields.duplicateOfRequestId),
      };
    case 'link':
      return { action, version, relatedId: requestId(fields.relatedRequestId) };
    case 'verify': {
      const quantity = positiveInteger(fields.confirmedQuantity, 'Confirmed quantity');
      const urgency = parseUrgency(fields.urgency);
      if (!urgency) throw new BadRequestException('Verified urgency is required');
      const source = fields.source;
      if (!source || typeof source !== 'object' || !('type' in source) ||
          (source.type !== 'shelter_intake' && source.type !== 'field_lead')) {
        throw new BadRequestException('A confirmation source is required');
      }
      return {
        action, version, quantity, urgency, sourceType: source.type,
        reference: requiredText('reference' in source ? source.reference : undefined, 'Confirmation reference', 200),
        rationale: requiredText(fields.rationale, 'Rationale', 2000),
      };
    }
  }
}
