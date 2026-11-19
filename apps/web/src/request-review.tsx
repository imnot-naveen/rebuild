import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { RequestApiError, submitReview } from './resident-api';
import type { GetToken, RequestDetail, ReviewAction } from './resident-api';

export const actionLabels: Record<ReviewAction, string> = {
  clarify: 'Ask for clarification',
  reply: 'Send reply',
  verify: 'Verify request',
  reject: 'Reject request',
  link: 'Link related request',
};

const savedMessages: Record<ReviewAction, string> = {
  clarify: 'Clarification requested.',
  reply: 'Reply sent. The request is back in review.',
  verify: 'Request verified.',
  reject: 'Request rejected.',
  link: 'Related request linked.',
};

interface ReviewFormProps {
  eventId: string;
  detail: RequestDetail;
  action: ReviewAction;
  getToken: GetToken;
  onSaved: (message: string) => void;
  onRefresh: () => void;
}

function reviewPayload(action: ReviewAction, version: number, form: HTMLFormElement) {
  const fields = new FormData(form);
  const text = (name: string) => String(fields.get(name) ?? '').trim();
  switch (action) {
    case 'clarify': return { version, question: text('message') };
    case 'reply': return { version, reply: text('message') };
    case 'reject': return { version, reason: text('message'), duplicateOfRequestId: text('related') || undefined };
    case 'link': return { version, relatedRequestId: text('related') };
    case 'verify': return {
      version,
      confirmedQuantity: Number(text('quantity')),
      urgency: text('urgency'),
      source: { type: text('source'), reference: text('reference') },
      rationale: text('message'),
    };
  }
}

const messageLabels = { clarify: 'Question for the resident', reply: 'Your reply', reject: 'Reason for the resident',
  verify: 'Coordinator rationale' };

export function RequestReviewForm({ eventId, detail, action, getToken, onSaved, onRefresh }: ReviewFormProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; conflict: boolean }>();
  const active = useRef<AbortController | null>(null);
  const retry = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => () => active.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (active.current || error?.conflict) return;

    const body = JSON.stringify(reviewPayload(action, detail.version, event.currentTarget));
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(undefined);
    try {
      await submitReview(eventId, detail.id, action, getToken, body, retry.current.key, controller.signal);
      if (!controller.signal.aborted) onSaved(savedMessages[action]);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError({
          message: reason instanceof Error ? reason.message : 'Could not save the review. Try again.',
          conflict: reason instanceof RequestApiError && reason.status === 409,
        });
      }
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return (
    <form className="request-form" onSubmit={(event) => void handleSubmit(event)}>
      <fieldset disabled={pending || error?.conflict} aria-label={actionLabels[action]}>
        {action === 'verify' && (
          <>
            <p>Confirm the need and delivery location within this event. Use a synthetic reference for the demo.</p>
            <label className="request-field">
              Confirmed quantity ({detail.unit})
              <input name="quantity" type="number" min={1} max={2147483647} step={1} defaultValue={detail.quantity} required />
            </label>
            <label className="request-field">
              Verified urgency
              <select name="urgency" defaultValue="" required>
                <option value="" disabled>Select urgency</option>
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="request-field">
              Confirmation source
              <select name="source" defaultValue="" required>
                <option value="" disabled>Select source</option>
                <option value="shelter_intake">Shelter intake record</option>
                <option value="field_lead">Field lead</option>
              </select>
            </label>
            <label className="request-field">
              Confirmation reference
              <input name="reference" maxLength={200} required />
            </label>
          </>
        )}
        {action !== 'link' && (
          <label className="request-field">
            {messageLabels[action]}
            <textarea name="message" rows={3} maxLength={2000} required />
          </label>
        )}
        {(action === 'link' || action === 'reject') && (
          <label className="request-field">
            {action === 'link' ? 'Related request ID' : 'Duplicate of request ID (optional)'}
            <input name="related" maxLength={36} required={action === 'link'} />
          </label>
        )}
        <button type="submit">{pending ? 'Saving…' : actionLabels[action]}</button>
      </fieldset>
      {error && <p role="alert">{error.message}</p>}
      {error?.conflict && <button type="button" onClick={onRefresh}>Refresh request details</button>}
    </form>
  );
}
