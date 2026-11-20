import { BadRequestException } from '@nestjs/common';
import { parseLocation, parsePositiveQuantity, requiredText } from '../operations/input';
import type { ReviewCommand, Urgency } from './review';

export interface ReportInput {
  category: string;
  unit: string;
  quantity: number;
  description: string;
  location: { latitude: number; longitude: number };
}

export interface RequestSummary {
  id: string;
  category: string;
  unit: string;
  quantity: number;
  reviewState: ReviewState;
  version: number;
  createdAt: string;
  verifiedQuantity?: number;
  verifiedUrgency?: Urgency;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  location: ReportInput['location'];
  activity: {
    version: number;
    action: ReviewCommand['action'];
    createdAt: string;
    text?: string;
    actorId?: string;
    source?: { type: string; reference: string };
    rationale?: string;
    relatedRequestId?: string;
    confirmedQuantity?: number;
    urgency?: Urgency;
  }[];
}

export type ReviewState = 'submitted' | 'needs_clarification' | 'verified' | 'rejected';

export function parseReviewState(value: unknown): ReviewState | undefined {
  if (value === undefined || value === 'submitted' || value === 'needs_clarification' ||
      value === 'verified' || value === 'rejected') {
    return value;
  }
  throw new BadRequestException('Invalid review state');
}

export function parseReport(body: unknown): ReportInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a request object');
  }
  const { category, unit, quantity, description, location } = body as Record<string, unknown>;
  const parsedQuantity = parsePositiveQuantity(quantity);
  const parsedLocation = parseLocation(location);
  return {
    category: requiredText(category, 'Category', 64),
    unit: requiredText(unit, 'Unit', 64),
    quantity: parsedQuantity,
    description: requiredText(description, 'Description', 2000),
    location: parsedLocation,
  };
}
