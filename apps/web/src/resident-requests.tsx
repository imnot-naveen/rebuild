import { useEffect, useRef, useState } from 'react';
import { readResidentRequest } from './resident-api';
import type { GetToken, RequestDetail, RequestPage, RequestSummary } from './resident-api';

interface ResidentProps {
  eventId: string;
  getToken: GetToken;
}

const reviewLabels: Record<string, string> = {
  submitted: 'Submitted',
  needs_clarification: 'Needs clarification',
  verified: 'Verified',
  rejected: 'Rejected',
};

const requestDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function RequestDate({ value }: { value: string }) {
  return <time dateTime={value}>{requestDate.format(new Date(value))}</time>;
}

function RequestDetails({ eventId, getToken, requestId }: ResidentProps & { requestId: string }) {
  const [detail, setDetail] = useState<RequestDetail>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readResidentRequest<RequestDetail>(eventId, getToken, `/${encodeURIComponent(requestId)}`, signal)
      .then((result) => {
        if (!signal.aborted) setDetail(result);
      })
      .catch((reason: Error) => {
        if (!signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [eventId, getToken, requestId, attempt]);

  return (
    <section className="request-details" id="request-details" aria-labelledby="details-heading">
      <h2 id="details-heading" tabIndex={-1} ref={heading}>Request details</h2>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}>Try again</button>
        </>
      ) : detail ? (
        <dl>
          <dt>Category</dt><dd>{detail.category}</dd>
          <dt>Quantity</dt><dd>{detail.quantity} {detail.unit}</dd>
          <dt>Status</dt><dd>{reviewLabels[detail.reviewState] ?? detail.reviewState}</dd>
          <dt>Date submitted</dt><dd><RequestDate value={detail.createdAt} /></dd>
          <dt>Description</dt><dd className="description">{detail.description}</dd>
          <dt>Location (latitude, longitude)</dt>
          <dd>{detail.location.latitude}, {detail.location.longitude}</dd>
        </dl>
      ) : (
        <p role="status">Loading request details…</p>
      )}
    </section>
  );
}

export function ResidentRequests({ eventId, getToken }: ResidentProps) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [page, setPage] = useState<{ cursor: string | null }>({ cursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const query = page.cursor ? `?${new URLSearchParams({ cursor: page.cursor })}` : '';
    void readResidentRequest<RequestPage>(eventId, getToken, query, signal)
      .then((result) => {
        if (signal.aborted) return;
        setRequests((previous) => page.cursor ? [...previous, ...result.requests] : result.requests);
        setNextCursor(result.nextCursor);
        setLoading(false);
      })
      .catch((reason: Error) => {
        if (signal.aborted) return;
        setError(reason.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [eventId, getToken, page]);

  function loadPage(cursor: string | null) {
    setError('');
    setLoading(true);
    setPage({ cursor });
  }

  return (
    <section aria-labelledby="requests-heading">
      <h2 id="requests-heading">My requests</h2>
      {requests.length > 0 && (
        <ul className="requests">
          {requests.map((request) => (
            <li key={request.id}>
              <button
                type="button"
                className="request-link"
                aria-expanded={selectedId === request.id}
                aria-controls={selectedId === request.id ? 'request-details' : undefined}
                onClick={() => setSelectedId(selectedId === request.id ? undefined : request.id)}
              >
                <strong>{request.category} · {request.quantity} {request.unit}</strong>
                <span>{reviewLabels[request.reviewState] ?? request.reviewState} · <RequestDate value={request.createdAt} /></span>
              </button>
              {selectedId === request.id && (
                <RequestDetails eventId={eventId} getToken={getToken} requestId={request.id} />
              )}
            </li>
          ))}
        </ul>
      )}
      {loading && <p role="status">Loading requests…</p>}
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={() => loadPage(page.cursor)}>Try again</button>
        </>
      )}
      {!loading && !error && requests.length === 0 && <p>You have no requests for this event yet.</p>}
      {nextCursor && !error && (
        <button type="button" disabled={loading} onClick={() => loadPage(nextCursor)}>
          Load more requests
        </button>
      )}
    </section>
  );
}
