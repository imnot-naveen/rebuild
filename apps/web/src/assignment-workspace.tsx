import { useEffect, useRef, useState } from 'react';
import { coordinatorRequest } from './coordinator-api';
import type { CoordinatorAccess } from './coordinator-api';
import { useCoordinatorMutation } from './coordinator-mutation';

const stateLabels = {
  assigned: 'Assigned', accepted: 'Accepted', in_transit: 'In transit', completed: 'Completed', cancelled: 'Cancelled',
};

const actionLabels = {
  acceptance: 'Accept assignment', transit: 'Start transit', deliveries: 'Record delivery', cancellation: 'Cancel assignment',
};

type AssignmentAction = keyof typeof actionLabels;
type AssignmentRole = 'coordinator' | 'volunteer';
type Coordinates = { latitude: number; longitude: number };

interface Assignment {
  id: string;
  category: string;
  unit: string;
  state: keyof typeof stateLabels;
  assignedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  version: number;
  generalArea: Coordinates;
  location?: Coordinates;
  instructions?: string;
  requestId?: string;
  lotId?: string;
  volunteerId?: string;
}

interface AssignmentPage {
  assignments: Assignment[];
  nextCursor: string | null;
}

interface AssignmentWorkspaceProps extends CoordinatorAccess {
  role: AssignmentRole;
  revision?: number;
  onChanged?: () => void;
}

function availableAction(role: AssignmentRole, state: Assignment['state']): AssignmentAction | undefined {
  if (state === 'completed' || state === 'cancelled') return;
  if (role === 'coordinator') return 'cancellation';
  if (state === 'assigned') return 'acceptance';
  if (state === 'accepted') return 'transit';
  return 'deliveries';
}

function AssignmentActionForm({ access, assignment, action, onSaved, onRefresh }: {
  access: CoordinatorAccess;
  assignment: Assignment;
  action: AssignmentAction;
  onSaved: () => void;
  onRefresh: () => void;
}) {
  const { error, submitting, submit } = useCoordinatorMutation(access);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const stale = error?.code === 'STALE_VERSION' || error?.code === 'INVALID_TRANSITION' || error?.code === 'not_found';

  return (
    <form className="request-form" onSubmit={(event) => {
      event.preventDefault();
      const input = { version: assignment.version,
        ...(action === 'deliveries' ? { quantity: Number(quantity) } : {}),
        ...(action === 'cancellation' ? { reason: reason.trim() } : {}),
      };
      void submit(`/assignments/${assignment.id}/${action}`, 'POST', input, onSaved);
    }}>
      <fieldset disabled={submitting || stale}>
        {action === 'deliveries' && (
          <label className="request-field">
            Quantity delivered ({assignment.unit})
            <input type="number" inputMode="numeric" required min={1} max={assignment.remainingQuantity} step={1}
              value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
        )}
        {action === 'cancellation' && (
          <label className="request-field">
            Cancellation reason
            <textarea required maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        )}
        <button type="submit" disabled={action === 'cancellation' && !reason.trim()}>
          {submitting ? 'Saving…' : actionLabels[action]}
        </button>
      </fieldset>
      {error && <p className="field-error" role="alert">{error.message}</p>}
      {stale && <button type="button" onClick={onRefresh}>Refresh assignment</button>}
    </form>
  );
}

function AssignmentDetails({ eventId, getToken, role, assignmentId, onUpdated }: CoordinatorAccess & {
  role: AssignmentRole;
  assignmentId: string;
  onUpdated: () => void;
}) {
  const [detail, setDetail] = useState<Assignment>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void coordinatorRequest<Assignment>({ eventId, getToken }, `/assignments/${assignmentId}`, signal)
      .then((assignment) => { if (!signal.aborted) setDetail(assignment); })
      .catch((reason: Error) => { if (!signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [eventId, getToken, assignmentId, attempt]);

  function refresh() {
    setDetail(undefined);
    setError('');
    setAttempt((value) => value + 1);
  }

  const action = detail && availableAction(role, detail.state);
  return (
    <section className="request-details" id="assignment-details" aria-labelledby="assignment-details-heading">
      <h3 id="assignment-details-heading" tabIndex={-1} ref={heading}>Assignment details</h3>
      <p className="form-status" role="status">{notice}</p>
      {error ? <>
        <p role="alert">{error}</p>
        <button type="button" onClick={refresh}>Try again</button>
      </> : detail ? <>
        <dl>
          <dt>Category</dt><dd>{detail.category}</dd>
          <dt>Status</dt><dd>{stateLabels[detail.state]}</dd>
          <dt>Assigned</dt><dd>{detail.assignedQuantity} {detail.unit}</dd>
          <dt>Delivered</dt><dd>{detail.deliveredQuantity} {detail.unit}</dd>
          <dt>Remaining reservation</dt><dd>{detail.remainingQuantity} {detail.unit}</dd>
          {detail.location ? <>
            <dt>Delivery location (latitude, longitude)</dt><dd>{detail.location.latitude}, {detail.location.longitude}</dd>
          </> : <>
            <dt>General area (latitude, longitude)</dt><dd>{detail.generalArea.latitude}, {detail.generalArea.longitude}</dd>
          </>}
          {detail.instructions && <><dt>Delivery instructions</dt><dd className="description">{detail.instructions}</dd></>}
          {role === 'coordinator' && <>
            <dt>Assignment ID</dt><dd>{detail.id}</dd>
            <dt>Request ID</dt><dd>{detail.requestId}</dd>
            <dt>Stock lot ID</dt><dd>{detail.lotId}</dd>
            <dt>Volunteer ID</dt><dd>{detail.volunteerId}</dd>
          </>}
        </dl>
        {action && <AssignmentActionForm key={detail.version} access={{ eventId, getToken }} assignment={detail}
          action={action} onRefresh={() => { refresh(); onUpdated(); }} onSaved={() => {
            setNotice({ acceptance: 'Assignment accepted.', transit: 'Assignment in transit.',
              deliveries: 'Delivery recorded.', cancellation: 'Assignment cancelled.' }[action]);
            heading.current?.focus();
            refresh();
            onUpdated();
          }} />}
      </> : <p role="status">Loading assignment details…</p>}
    </section>
  );
}

export function AssignmentWorkspace({ eventId, getToken, role, revision, onChanged }: AssignmentWorkspaceProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [page, setPage] = useState({ cursor: '', state: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const previousRevision = useRef(revision);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const params = new URLSearchParams();
    if (page.state) params.set('state', page.state);
    if (page.cursor) params.set('cursor', page.cursor);
    const query = params.size ? `?${params}` : '';
    void coordinatorRequest<AssignmentPage>({ eventId, getToken }, `/assignments${query}`, signal)
      .then((result) => {
        if (signal.aborted) return;
        setAssignments((previous) => page.cursor ? [...previous, ...result.assignments] : result.assignments);
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

  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    setError('');
    setLoading(true);
    setPage((previous) => ({ ...previous, cursor: '' }));
  }, [revision]);

  function loadPage(cursor: string, state = page.state) {
    setError('');
    setLoading(true);
    setPage({ cursor, state });
  }

  return (
    <section aria-labelledby="assignments-heading">
      <h2 id="assignments-heading">{role === 'volunteer' ? 'My assignments' : 'Assignments'}</h2>
      <label className="request-field">
        Assignment state
        <select value={page.state} onChange={(event) => {
          setAssignments([]);
          setNextCursor(null);
          setSelectedId(undefined);
          loadPage('', event.target.value);
        }}>
          <option value="">All states</option>
          {Object.entries(stateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      {assignments.length > 0 && <ul className="requests">
        {assignments.map((assignment) => <li key={assignment.id}>
          <button type="button" className="request-link" aria-expanded={selectedId === assignment.id}
            aria-controls={selectedId === assignment.id ? 'assignment-details' : undefined}
            onClick={() => setSelectedId(selectedId === assignment.id ? undefined : assignment.id)}>
            <strong>{assignment.category} · {assignment.assignedQuantity} {assignment.unit}</strong>
            <span>{stateLabels[assignment.state]} · {assignment.deliveredQuantity} delivered</span>
            <span>Area {assignment.generalArea.latitude}, {assignment.generalArea.longitude}</span>
            {role === 'coordinator' && <span>{assignment.id}</span>}
          </button>
        </li>)}
      </ul>}
      {loading && <p role="status">Loading assignments…</p>}
      {error && <>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => loadPage(page.cursor)}>
          Try again
        </button>
      </>}
      {!loading && !error && assignments.length === 0 && <p>No assignments match this view.</p>}
      {nextCursor && !error && <button type="button" disabled={loading} onClick={() => loadPage(nextCursor)}>
        Load more assignments
      </button>}
      {selectedId && <AssignmentDetails key={selectedId} eventId={eventId} getToken={getToken}
        role={role} assignmentId={selectedId} onUpdated={onChanged ?? (() => loadPage(''))} />}
    </section>
  );
}
