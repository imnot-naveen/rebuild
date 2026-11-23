export type GetToken = () => Promise<string | undefined>;

export async function fetchEvent(
  eventId: string,
  getToken: GetToken,
  path: string,
  signal: AbortSignal,
  options: RequestInit,
  connectionError: string,
) {
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
  try {
    return await fetch(`/v1/events/${encodeURIComponent(eventId)}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
  } catch {
    throw new Error(connectionError);
  }
}
