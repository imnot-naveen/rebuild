import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { submitResidentRequest } from './resident-api';
import type { GetToken } from './resident-api';

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
const maxQuantity = 2_147_483_647;

export function RequestHelp({ eventId, getToken, onSubmitted }: RequestHelpProps) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState('');
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const attempt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;

    setStatus('');
    setSubmitError('');
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: Field) => String(data.get(name) ?? '').trim();
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

    const body = JSON.stringify({ category, unit, quantity, description, location: { latitude, longitude } });
    const controller = new AbortController();
    pending.current = controller;
    setSubmitting(true);
    try {
      // The server may have committed even when the browser did not get a response.
      if (attempt.current?.body !== body) {
        attempt.current = { body, key: crypto.randomUUID() };
      }
      await submitResidentRequest(eventId, getToken, body, attempt.current.key, controller.signal);
      if (controller.signal.aborted) return;

      attempt.current = null;
      form.reset();
      setStatus('Request submitted.');
      onSubmitted();
    } catch (error) {
      if (!controller.signal.aborted) {
        setSubmitError(error instanceof Error ? error.message : 'Could not submit your request. Try again.');
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="request-help-heading">
      <h2 id="request-help-heading">Request help</h2>
      <form className="request-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <fieldset disabled={submitting} aria-label="Request details">
          {fields.map((field) => {
            const id = `request-${field.name}`;
            const error = fieldErrors[field.name];
            const control = {
              id,
              name: field.name,
              required: true,
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
          <button type="submit">{submitting ? 'Submitting…' : 'Submit request'}</button>
        </fieldset>
        {submitError && <p role="alert">{submitError}</p>}
        <p className="form-status" role="status">{status}</p>
      </form>
    </section>
  );
}
