import { useEffect, useRef, useState } from 'react';
import { CoordinatorApiError, coordinatorRequest } from './coordinator-api';
import type { CoordinatorAccess } from './coordinator-api';

export function useCoordinatorMutation(access: CoordinatorAccess) {
  const [error, setError] = useState<CoordinatorApiError>();
  const [submitting, setSubmitting] = useState(false);
  const active = useRef<AbortController | null>(null);
  const attempt = useRef<{ fingerprint: string; key: string } | undefined>(undefined);

  useEffect(() => () => active.current?.abort(), []);

  async function submit<T>(
    path: string, method: 'POST' | 'PATCH', input: object, onSaved: (result: T) => void,
  ) {
    if (active.current) return;
    const body = JSON.stringify(input);
    const fingerprint = JSON.stringify([method, path, body]);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: crypto.randomUUID() };
    }

    const controller = new AbortController();
    active.current = controller;
    setError(undefined);
    setSubmitting(true);
    try {
      const result = await coordinatorRequest<T>(access, path, controller.signal,
        { method, body, key: attempt.current.key });
      if (controller.signal.aborted) return;
      attempt.current = undefined;
      onSaved(result);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof CoordinatorApiError
        ? reason
        : new CoordinatorApiError(reason instanceof Error ? reason.message : 'Could not save the change.'));
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return { error, submitting, submit };
}
