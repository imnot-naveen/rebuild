import { fetchEvent } from './event-api';
import type { GetToken } from './event-api';

export interface CoordinatorAccess {
  eventId: string;
  getToken: GetToken;
}

export interface StockLot {
  id: string;
  category: string;
  unit: string;
  receivedQuantity: number;
  reservedQuantity: number;
  deliveredQuantity: number;
  availableQuantity: number;
  version: number;
  createdAt: string;
}

export interface StockLotDetail extends StockLot {
  location: { latitude: number; longitude: number };
}

export interface StockPage {
  stockLots: StockLot[];
  nextCursor: string | null;
}

export interface SuggestedLots {
  requestVersion: number;
  allocatableQuantity: number;
  candidates: {
    lotId: string;
    distanceMetres: number;
    availableQuantity: number;
    coveredQuantity: number;
    explanation: string;
  }[];
}

export interface Reservation {
  id: string;
  quantity: number;
  availableQuantity: number;
  reservedQuantity: number;
  allocatableQuantity: number;
}

export class CoordinatorApiError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function coordinatorRequest<T>(
  { eventId, getToken }: CoordinatorAccess,
  path: string,
  signal: AbortSignal,
  mutation?: { method: 'POST' | 'PATCH'; body: string; key: string },
): Promise<T> {
  const uncertain = 'The service could not confirm the change. Submit the same values to retry safely.';
  const options = mutation ? {
    method: mutation.method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mutation.key },
    body: mutation.body,
  } : {};
  const response = await fetchEvent(eventId, getToken, path, signal, options,
    mutation ? uncertain : 'Could not reach the event service. Try again.');
  const result = await response.json().catch(() => null);
  if (response.ok && result) return result as T;

  if (response.ok || response.status >= 500) {
    throw new CoordinatorApiError(mutation ? uncertain : 'The event service is unavailable. Try again.');
  }
  if (response.status === 401) {
    throw new CoordinatorApiError('Your session has expired. Log out and sign in again.');
  }
  if (response.status === 403) {
    throw new CoordinatorApiError('Your account lacks permission for this action in this event.');
  }

  const { availableQuantity, allocatableQuantity, minimumReceivedQuantity, remainingQuantity } = result?.details ?? {};
  const message = typeof result?.message === 'string' ? result.message : 'The event service could not complete the action.';
  const quantities = [
    [availableQuantity, 'Available stock'],
    [allocatableQuantity, 'Allocatable need'],
    [minimumReceivedQuantity, 'Minimum received quantity'],
    [remainingQuantity, 'Remaining reservation'],
  ] as const;
  const detail = quantities.find(([quantity]) => typeof quantity === 'number');
  throw new CoordinatorApiError(detail ? `${message}. ${detail[1]} is ${detail[0]}.` : message, result?.code);
}
