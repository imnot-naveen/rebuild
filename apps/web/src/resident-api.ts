export interface RequestSummary {
  id: string;
  category: string;
  unit: string;
  quantity: number;
  reviewState: string;
  createdAt: string;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  location: { latitude: number; longitude: number };
}

export interface RequestPage {
  requests: RequestSummary[];
  nextCursor: string | null;
}

export type GetToken = () => Promise<string | undefined>;

const errorMessages: Record<number, string> = {
  401: 'Your session has expired. Log out and sign in again.',
  403: 'Your account does not have resident access to this event.',
  404: 'This request is unavailable.',
  409: 'The requests service could not confirm this submission because its retry key was already used.',
  503: 'The requests service is temporarily unavailable. Try again shortly.',
};

async function sendResidentRequest(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
  options: RequestInit = {},
): Promise<Response> {
  let token: string | undefined;
  try {
    token = await getToken();
  } catch {
    throw new Error('Your sign-in could not be refreshed. Log out and sign in again.');
  }
  if (!token) throw new Error('Your session has expired. Log out and sign in again.');
  signal.throwIfAborted();

  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(`/v1/events/${encodeURIComponent(eventId)}/requests${path}`, {
      ...options,
      headers,
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
  } catch {
    const message = options.method === 'POST'
      ? 'We could not confirm your submission. Submit the same report again to retry safely.'
      : 'The requests service could not be reached. Check your connection and try again.';
    throw new Error(message);
  }

  if (!response.ok) {
    if (options.method === 'POST' && response.status === 400) {
      const error = await response.json().catch(() => null);
      if (typeof error?.message === 'string') throw new Error(error.message);
    }
    throw new Error(errorMessages[response.status] ?? 'The requests service could not complete your request.');
  }
  return response;
}

export async function readResidentRequest<T>(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await sendResidentRequest(eventId, getToken, path, signal);
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
  const response = await sendResidentRequest(eventId, getToken, '', signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body,
  });
  if (response.status !== 201) throw new Error('The requests service could not confirm your submission.');
}
