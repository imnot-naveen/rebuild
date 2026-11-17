import { BadRequestException } from '@nestjs/common';

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
  reviewState: string;
  version: number;
  createdAt: string;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  location: ReportInput['location'];
}

function requiredText(value: unknown, name: string, maxLength: number): string {
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
