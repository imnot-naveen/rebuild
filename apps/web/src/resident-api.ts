import { fetchEvent } from './event-api';
import type { GetToken } from './event-api';

export type { GetToken } from './event-api';
export type ReviewRole = 'resident' | 'coordinator';
export type Urgency = 'routine' | 'urgent' | 'critical';
export type ReviewAction = 'clarify' | 'reply' | 'verify' | 'reject' | 'link';

export interface RequestSummary {
  id: string;
  category: string;
  unit: string;
  quantity: number;
  reviewState: string;
  version: number;
  createdAt: string;
  verifiedQuantity?: number;
  verifiedUrgency?: Urgency;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  location: { latitude: number; longitude: number };
  fulfilment?: {
    deliveredQuantity: number;
    outstandingQuantity: number;
    allocatableQuantity?: number;
  };
  activity: {
    version: number;
    action: ReviewAction;
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

export interface RequestPage {
  requests: RequestSummary[];
  nextCursor: string | null;
}

const errorMessages: Record<number, string> = {
  401: 'Your session has expired. Log out and sign in again.',
  403: 'Your account does not have permission for this action in this event.',
  404: 'This request is unavailable.',
  409: 'The requests service could not confirm this submission because its retry key was already used.',
  503: 'The requests service is temporarily unavailable. Try again shortly.',
};

export class RequestApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function sendRequest(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<Response> {
  const response = await fetchEvent(eventId, getToken, `/requests${path}`, signal, options,
    options.method === 'POST'
      ? 'We could not confirm your submission. Send the same information again to retry safely.'
      : 'The requests service could not be reached. Check your connection and try again.');

  if (!response.ok) {
    if (options.method === 'POST' && (response.status === 400 || (path && response.status === 409))) {
      const error = await response.json().catch(() => null);
      if (typeof error?.message === 'string') throw new RequestApiError(error.message, response.status);
    }
    throw new RequestApiError(
      errorMessages[response.status] ?? 'The requests service could not complete your request.', response.status,
    );
  }
  return response;
}

export async function readRequest<T>(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await sendRequest(eventId, getToken, path, signal);
  try {
    return await response.json() as T;
  } catch {
    throw new Error('The requests service returned an unexpected response.');
  }
}

export async function submitResidentRequest(
  eventId: string,
  getToken: GetToken,
  body: string,
  key: string,
  signal: AbortSignal,
): Promise<void> {
  const response = await sendRequest(eventId, getToken, '', signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body,
  });
  if (response.status !== 201) throw new Error('The requests service could not confirm your submission.');
}

const reviewRoutes: Record<ReviewAction, string> = {
  clarify: 'clarifications', reply: 'replies', verify: 'verification', reject: 'rejection', link: 'related-reports',
};

export async function submitReview(
  eventId: string, requestId: string, action: ReviewAction, getToken: GetToken,
  body: string, key: string, signal: AbortSignal,
) {
  await sendRequest(eventId, getToken, `/${encodeURIComponent(requestId)}/${reviewRoutes[action]}`, signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body,
  });
}
