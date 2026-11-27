import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useOnline } from './connectivity';
import { RequestApiError, submitResidentRequest } from './resident-api';
import type { GetToken } from './resident-api';
import { DraftChangedError, readDraft, writeDraft } from './request-drafts';
import type { DraftScope, RequestDraft } from './request-drafts';

interface RequestHelpProps {
  eventId: string;
  getToken: GetToken;
  onSubmitted: () => void;
}

const fields = [
  { name: 'category', label: 'Category code', placeholder: 'drinking-water', maxLength: 64 },
  { name: 'unit', label: 'Unit', placeholder: 'cases', maxLength: 64 },
  { name: 'quantity', label: 'Quantity', step: '1' },
  { name: 'description', label: 'Description', maxLength: 2000 },
  { name: 'latitude', label: 'Latitude', step: 'any' },
  { name: 'longitude', label: 'Longitude', step: 'any' },
] as const;

type Field = typeof fields[number]['name'];
type FieldErrors = Partial<Record<Field, string>>;
type DraftFields = Record<Field, string>;
type Draft = RequestDraft<DraftFields>;
const maxQuantity = 2_147_483_647;
const emptyFields: DraftFields = {
  category: '', unit: '', quantity: '', description: '', latitude: '', longitude: '',
};

export function RequestHelp(props: RequestHelpProps) {
  const { user, isAuthenticated } = useAuth0();
  const subject = isAuthenticated ? user?.sub : undefined;
  const scope = useMemo((): DraftScope | undefined => subject ? [
    import.meta.env.VITE_AUTH0_DOMAIN, import.meta.env.VITE_AUTH0_CLIENT_ID, subject, props.eventId,
  ] : undefined, [props.eventId, subject]);

  return (
    <section aria-labelledby="request-help-heading">
      <h2 id="request-help-heading">Request help</h2>
      {scope ? <SavedRequestForm key={JSON.stringify(scope)} {...props} scope={scope} /> : (
        <p role="status">Sign in to open your request drafts.</p>
      )}
    </section>
  );
}

type ScopedRequestHelpProps = RequestHelpProps & { scope: DraftScope };

function SavedRequestForm(props: ScopedRequestHelpProps) {
  const { scope } = props;
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ draft?: Draft; failed?: true }>();

  useEffect(() => {
    let current = true;
    void readDraft<DraftFields>(scope).then(
      (draft) => { if (current) setLoaded({ draft }); },
      () => { if (current) setLoaded({ failed: true }); },
    );
    return () => { current = false; };
  }, [scope, attempt]);

  function reopen() {
    setLoaded(undefined);
    setAttempt((previous) => previous + 1);
  }

  if (!loaded) return <p role="status">Opening local draft…</p>;
  if (loaded.failed) return (
    <>
      <p role="alert">Draft storage is unavailable. Enable site storage in your browser and try again.</p>
      <button type="button" onClick={reopen}>Try again</button>
    </>
  );
  return <RequestForm {...props} initialDraft={loaded.draft} reopen={reopen} />;
}

function RequestForm({ eventId, getToken, onSubmitted, scope, initialDraft, reopen }: ScopedRequestHelpProps & {
  initialDraft?: Draft;
  reopen: () => void;
}) {
  const online = useOnline();
  const [draft, setDraft] = useState(initialDraft);
  const [values, setValues] = useState(initialDraft?.fields ?? emptyFields);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsReopen, setNeedsReopen] = useState(false);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  const submission = draft?.submission;
  const dirty = draft && fields.some(({ name }) => draft.fields[name] !== values[name]);
  const status = sent ? 'Request sent.' : submission
    ? 'Waiting to send. Retrying uses the original request.'
    : draft ? (dirty ? 'Draft has unsaved changes.' : 'Draft saved on this device.') : '';

  function validate(form: HTMLFormElement) {
    const text = (name: Field) => values[name].trim();
    const category = text('category');
    const unit = text('unit');
    const description = text('description');
    const quantity = Number(text('quantity') || NaN);
    const latitude = Number(text('latitude') || NaN);
    const longitude = Number(text('longitude') || NaN);

    const errors: FieldErrors = {};
    if (!category) errors.category = 'Enter the category code.';
    if (!unit) errors.unit = 'Enter the unit.';
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) {
      errors.quantity = 'Enter a whole number from 1 to 2,147,483,647.';
    }
    if (!description) errors.description = 'Describe what help you need.';
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) {
      errors.latitude = 'Enter a latitude from −90 to 90.';
    }
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      errors.longitude = 'Enter a longitude from −180 to 180.';
    }
    setFieldErrors(errors);

    const firstInvalid = fields.find(({ name }) => errors[name]);
    if (firstInvalid) {
      form.querySelector<HTMLElement>(`[name="${firstInvalid.name}"]`)?.focus();
      return;
    }

    return JSON.stringify({ category, unit, quantity, description, location: { latitude, longitude } });
  }

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (pending.current || needsReopen) return;
    const controller = new AbortController();
    pending.current = controller;
    setError('');
    setBusy(true);
    try {
      await action(controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) {
        if (reason instanceof DraftChangedError) setNeedsReopen(true);
        setError(reason instanceof Error ? reason.message : 'Could not update the draft. Try again.');
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function persist(expected: Draft | undefined, next?: Draft) {
    try {
      await writeDraft(scope, expected?.revision, next);
    } catch (reason) {
      if (reason instanceof DraftChangedError) throw reason;
      throw new Error('Could not update the draft on this device. Check browser storage and try again.');
    }
  }

  function save() {
    void run(async (signal) => {
      const next = { fields: values, revision: crypto.randomUUID() };
      await persist(draft, next);
      if (signal.aborted) return;
      setDraft(next);
      setSent(false);
    });
  }

  function discard() {
    const message = submission
      ? 'Discard the saved draft and its retry information? The service may already have received this request.'
      : 'Discard this draft from this device?';
    if (!window.confirm(message)) return;
    void run(async (signal) => {
      await persist(draft);
      if (signal.aborted) return;
      setDraft(undefined);
      setValues(emptyFields);
      setFieldErrors({});
      setSent(false);
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !online) return;
    const body = submission?.body ?? validate(event.currentTarget);
    if (!body) return;

    void run(async (signal) => {
      const operation = submission ?? { body, key: crypto.randomUUID() };
      const waiting = { fields: values, revision: crypto.randomUUID(), submission: operation };
      // Commit the key and exact payload before any network request can reach the service.
      await persist(draft, waiting);
      if (signal.aborted) return;
      setDraft(waiting);
      setSent(false);
      try {
        await submitResidentRequest(eventId, getToken, operation.body, operation.key, signal);
      } catch (reason) {
        if (!signal.aborted && !submission && reason instanceof RequestApiError && reason.status === 400) {
          // The first response definitively rejected the request. Allow corrections.
          const editable = { fields: values, revision: crypto.randomUUID() };
          await persist(waiting, editable);
          if (!signal.aborted) setDraft(editable);
        }
        throw reason;
      }

      if (!signal.aborted) {
        setSent(true);
        onSubmitted();
      }
      try {
        await persist(waiting);
      } catch (reason) {
        if (!signal.aborted) setNeedsReopen(true);
        throw reason;
      }
      if (signal.aborted) return;
      setDraft(undefined);
      setValues(emptyFields);
      setFieldErrors({});
    });
  }

  return (
    <form className="request-form" noValidate onSubmit={handleSubmit}>
      {!online && <p role="status">You’re offline. You can save a draft and send it after reconnecting.</p>}
      <fieldset disabled={busy || needsReopen} aria-label="Request details">
        {fields.map((field) => {
          const id = `request-${field.name}`;
          const error = fieldErrors[field.name];
          const control = {
            id,
            name: field.name,
            required: true,
            readOnly: Boolean(submission),
            value: values[field.name],
            onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              setValues({ ...values, [field.name]: event.currentTarget.value });
              setSent(false);
            },
            'aria-invalid': error ? true : undefined,
            'aria-describedby': error ? `${id}-error` : undefined,
          };
          return (
            <div className="request-field" key={field.name}>
              <label htmlFor={id}>{field.label}</label>
              {field.name === 'description' ? (
                <textarea {...control} maxLength={field.maxLength} rows={4} />
              ) : 'step' in field ? (
                <input {...control} type="number" step={field.step} />
              ) : (
                <input {...control} maxLength={field.maxLength} placeholder={field.placeholder} />
              )}
              {error && <p className="field-error" id={`${id}-error`} role="alert">{error}</p>}
            </div>
          );
        })}
        <div className="draft-actions">
          <button type="submit" disabled={!online}>{submission ? 'Retry submission' : 'Submit request'}</button>
          {!submission && <button type="button" onClick={save}>Save draft</button>}
          {draft && <button type="button" onClick={discard}>Discard draft</button>}
        </div>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      {needsReopen && <button type="button" onClick={reopen}>Reopen saved draft</button>}
      <p className="form-status" role="status">{busy ? 'Working…' : status}</p>
    </form>
  );
}
