import { useEffect, useRef, useState } from 'react';
import { readRequest } from './resident-api';
import type { GetToken, RequestDetail, RequestPage, RequestSummary, ReviewAction, ReviewRole } from './resident-api';
import { actionLabels, RequestReviewForm } from './request-review';

interface WorkspaceProps {
  eventId: string;
  getToken: GetToken;
  role: ReviewRole;
}

const reviewLabels: Record<string, string> = {
  submitted: 'Submitted',
  needs_clarification: 'Needs clarification',
  verified: 'Verified',
  rejected: 'Rejected',
};

const activityLabels: Record<ReviewAction, string> = {
  clarify: 'Clarification requested', reply: 'Resident replied', verify: 'Request verified',
  reject: 'Request rejected', link: 'Related request linked',
};

const requestDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function RequestDate({ value }: { value: string }) {
  return <time dateTime={value}>{requestDate.format(new Date(value))}</time>;
}

function RequestDetails({ eventId, getToken, requestId, role, onUpdated }: WorkspaceProps & {
  requestId: string;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<RequestDetail>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [selectedAction, setSelectedAction] = useState<ReviewAction>();
  const [status, setStatus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void readRequest<RequestDetail>(eventId, getToken, `/${encodeURIComponent(requestId)}`, signal)
      .then((result) => {
        if (!signal.aborted) setDetail(result);
      })
      .catch((reason: Error) => {
        if (!signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [eventId, getToken, requestId, attempt]);

  function refresh() {
    setError('');
    setDetail(undefined);
    setAttempt((value) => value + 1);
  }

  const actions: ReviewAction[] = role === 'coordinator'
    ? detail?.reviewState === 'submitted' ? ['clarify', 'verify', 'reject', 'link'] : ['link']
    : detail?.reviewState === 'needs_clarification' ? ['reply'] : [];
  const action = selectedAction && actions.includes(selectedAction) ? selectedAction : actions[0];

  return (
    <section className="request-details" id="request-details" aria-labelledby="details-heading">
      <h2 id="details-heading" tabIndex={-1} ref={heading}>Request details</h2>
      <p className="form-status" role="status">{status}</p>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={refresh}>Try again</button>
        </>
      ) : detail ? (
        <>
          <dl>
            {role === 'coordinator' && <><dt>Request ID</dt><dd>{detail.id}</dd></>}
            <dt>Category</dt><dd>{detail.category}</dd>
            <dt>Quantity requested</dt><dd>{detail.quantity} {detail.unit}</dd>
            <dt>Status</dt><dd>{reviewLabels[detail.reviewState] ?? detail.reviewState}</dd>
            {detail.verifiedQuantity !== undefined && (
              <><dt>Quantity confirmed</dt><dd>{detail.verifiedQuantity} {detail.unit}</dd></>
            )}
            {detail.verifiedUrgency && <><dt>Verified urgency</dt><dd>{detail.verifiedUrgency}</dd></>}
            <dt>Date submitted</dt><dd><RequestDate value={detail.createdAt} /></dd>
            <dt>Description</dt><dd className="description">{detail.description}</dd>
            <dt>Location (latitude, longitude)</dt>
            <dd>{detail.location.latitude}, {detail.location.longitude}</dd>
          </dl>
          {detail.activity.length > 0 && (
            <>
              <h3>Request activity</h3>
              <ol className="request-activity">
                {detail.activity.map((entry) => (
                  <li key={entry.version}>
                    <strong>{activityLabels[entry.action]}</strong> · <RequestDate value={entry.createdAt} />
                    {entry.text && <p className="description">{entry.text}</p>}
                    {entry.actorId && <p>Recorded by {entry.actorId}</p>}
                    {entry.source && <p>{entry.source.type === 'shelter_intake' ? 'Shelter intake record' : 'Field lead'} · {entry.source.reference}</p>}
                    {entry.rationale && <p className="description">{entry.rationale}</p>}
                    {entry.relatedRequestId && <p>Related request {entry.relatedRequestId}</p>}
                  </li>
                ))}
              </ol>
            </>
          )}
          {action && (
            <>
              <h3>{role === 'coordinator' ? 'Review request' : 'Reply to clarification'}</h3>
              {actions.length > 1 && (
                <label className="request-field">
                  Review action
                  <select value={action} onChange={(event) => setSelectedAction(event.target.value as ReviewAction)}>
                    {actions.map((choice) => <option key={choice} value={choice}>{actionLabels[choice]}</option>)}
                  </select>
                </label>
              )}
              <RequestReviewForm key={`${detail.version}:${action}`} eventId={eventId} detail={detail} action={action}
                getToken={getToken} onRefresh={() => { refresh(); onUpdated(); }} onSaved={(message) => {
                  setStatus(message);
                  refresh();
                  onUpdated();
                }} />
            </>
          )}
        </>
      ) : (
        <p role="status">Loading request details…</p>
      )}
    </section>
  );
}

export function RequestWorkspace({ eventId, getToken, role }: WorkspaceProps) {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [page, setPage] = useState({ cursor: '', reviewState: '', urgency: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(page)) if (value) params.set(name, value);
    const query = params.size ? `?${params}` : '';
    void readRequest<RequestPage>(eventId, getToken, query, signal)
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

  function loadPage(cursor: string) {
    setError('');
    setLoading(true);
    setPage((previous) => ({ ...previous, cursor }));
  }

  function updateFilter(name: 'reviewState' | 'urgency', value: string) {
    setRequests([]);
    setNextCursor(null);
    setSelectedId(undefined);
    setError('');
    setLoading(true);
    setPage((previous) => ({ ...previous, [name]: value, cursor: '' }));
  }

  return (
    <section aria-labelledby="requests-heading">
      <h2 id="requests-heading">{role === 'coordinator' ? 'Coordinator queue' : 'My requests'}</h2>
      {role === 'coordinator' && (
        <div className="request-filters">
          <label className="request-field">
            Review state
            <select value={page.reviewState} onChange={(event) => updateFilter('reviewState', event.target.value)}>
              <option value="">All states</option>
              {Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="request-field">
            Verified urgency
            <select value={page.urgency} onChange={(event) => updateFilter('urgency', event.target.value)}>
              <option value="">All urgencies</option>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        </div>
      )}
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
                {request.verifiedUrgency && <span>Verified urgency {request.verifiedUrgency}</span>}
              </button>
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
      {!loading && !error && requests.length === 0 && (
        <p>{role === 'coordinator' ? 'No requests match the current filters.' : 'You have no requests for this event yet.'}</p>
      )}
      {nextCursor && !error && (
        <button type="button" disabled={loading} onClick={() => loadPage(nextCursor)}>
          Load more requests
        </button>
      )}
      {selectedId && (
        <RequestDetails key={selectedId} eventId={eventId} getToken={getToken} requestId={selectedId}
          role={role} onUpdated={() => loadPage('')} />
      )}
    </section>
  );
}
