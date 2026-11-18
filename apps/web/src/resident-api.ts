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
  503: 'The requests service is temporarily unavailable. Try again shortly.',
};

export async function readResidentRequest<T>(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
): Promise<T> {
  let token: string | undefined;
  try {
    token = await getToken();
  } catch {
    throw new Error('Your sign-in could not be refreshed. Log out and sign in again.');
  }
  if (!token) throw new Error('Your session has expired. Log out and sign in again.');
  signal.throwIfAborted();

  let response: Response;
  try {
    response = await fetch(`/v1/events/${encodeURIComponent(eventId)}/requests${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      cache: 'no-store',
      signal,
    });
  } catch {
    throw new Error('The requests service could not be reached. Check your connection and try again.');
  }

  if (!response.ok) {
    throw new Error(errorMessages[response.status] ?? 'The requests service could not complete your request.');
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error('The requests service returned an unexpected response.');
  }
}
