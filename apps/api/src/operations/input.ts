import { BadRequestException } from '@nestjs/common';

export interface PageOptions {
  limit: number;
  before?: { createdAt: string; id: string };
}

const cursorPattern = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})\d{3}Z\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parsePage(limit: unknown = '25', cursor?: unknown, resource = 'request'): PageOptions {
  if (typeof limit !== 'string' || !/^(?:[1-9]\d?|100)$/.test(limit)) {
    throw new BadRequestException('Limit must be a whole number from 1 to 100');
  }
  const size = Number(limit);
  if (cursor === undefined) {
    return { limit: size };
  }

  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(cursor)) {
    throw new BadRequestException(`Invalid ${resource} cursor`);
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = cursorPattern.exec(decoded);
  if (!match) {
    throw new BadRequestException(`Invalid ${resource} cursor`);
  }
  const milliseconds = `${match[1]}Z`;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.valueOf()) || date.toISOString() !== milliseconds || milliseconds.startsWith('0000')) {
    throw new BadRequestException(`Invalid ${resource} cursor`);
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

export function parsePositiveQuantity(value: unknown, name = 'Quantity'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new BadRequestException(`${name} must be a positive whole number in the database range`);
  }
  return value;
}

export function parseUuid(value: unknown, message: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException(message);
  }
  return value.toLowerCase();
}

export function parseLocation(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Location is required');
  }
  const { latitude, longitude } = value as Record<string, unknown>;
  return {
    latitude: coordinate(latitude, 'Latitude', 90),
    longitude: coordinate(longitude, 'Longitude', 180),
  };
}
