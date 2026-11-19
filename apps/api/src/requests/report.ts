import { BadRequestException } from '@nestjs/common';
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

export interface RequestPageOptions {
  limit: number;
  before?: { createdAt: string; id: string };
}

export function parseReviewState(value: unknown): ReviewState | undefined {
  if (value === undefined || value === 'submitted' || value === 'needs_clarification' ||
      value === 'verified' || value === 'rejected') {
    return value;
  }
  throw new BadRequestException('Invalid review state');
}

const cursorPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseRequestPage(limit: unknown = '25', cursor?: unknown): RequestPageOptions {
  if (typeof limit !== 'string' || !/^(?:[1-9]\d?|100)$/.test(limit)) {
    throw new BadRequestException('Limit must be a whole number from 1 to 100');
  }
  const size = Number(limit);
  if (cursor === undefined) {
    return { limit: size };
  }

  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(cursor)) {
    throw new BadRequestException('Invalid request cursor');
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = cursorPattern.exec(decoded);
  if (!match) {
    throw new BadRequestException('Invalid request cursor');
  }
  const milliseconds = `${match[1]}Z`;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== milliseconds || milliseconds.startsWith('0000')) {
    throw new BadRequestException('Invalid request cursor');
  }
  return { limit: size, before: { createdAt: decoded.split('/')[0], id: match[2] } };
}

export function requiredText(value: unknown, name: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || value.trim().length > maxLength) {
    throw new BadRequestException(`${name} must be text between 1 and ${maxLength} characters`);
  }
  return value.trim();
}

function coordinate(value: unknown, name: string, limit: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) {
    throw new BadRequestException(`${name} must be between -${limit} and ${limit}`);
  }
  return value;
}

export function parseReport(body: unknown): ReportInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Expected a request object');
  }
  const { category, unit, quantity, description, location } = body as Record<string, unknown>;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw new BadRequestException('Quantity must be a positive whole number in the database range');
  }
  if (!location || typeof location !== 'object' || Array.isArray(location)) {
    throw new BadRequestException('Location is required');
  }
  const { latitude, longitude } = location as Record<string, unknown>;
  return {
    category: requiredText(category, 'Category', 64),
    unit: requiredText(unit, 'Unit', 64),
    quantity,
    description: requiredText(description, 'Description', 2000),
    location: {
      latitude: coordinate(latitude, 'Latitude', 90),
      longitude: coordinate(longitude, 'Longitude', 180),
    },
  };
}
