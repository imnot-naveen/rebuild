import type { FormEvent } from 'react';
import type { CoordinatorAccess, Reservation } from './coordinator-api';
import { useCoordinatorMutation } from './coordinator-mutation';
import type { RequestDetail } from './resident-api';
import { useStockLots } from './stock-lots';

export function AssignmentForm({ access, request, stockRevision, onSaved, onRefresh }: {
  access: CoordinatorAccess;
  request: RequestDetail;
  stockRevision: number;
  onSaved: (reservation: Reservation) => void;
  onRefresh: () => void;
}) {
  const lots = useStockLots(access, request.category, stockRevision);
  const { error, submitting, submit } = useCoordinatorMutation(access);
  const compatibleLots = lots.stockLots.filter((lot) => lot.unit === request.unit);

  function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const instructions = String(data.get('instructions') ?? '').trim();
    void submit<Reservation>('/assignments', 'POST', {
      requestId: request.id,
      requestVersion: request.version,
      lotId: data.get('lotId'),
      volunteerId: String(data.get('volunteerId') ?? '').trim().toLowerCase(),
      quantity: Number(data.get('quantity')),
      instructions: instructions || undefined,
    }, onSaved);
  }

  return (
    <section aria-labelledby="reserve-heading">
      <h3 id="reserve-heading">Reserve stock and assign a volunteer</h3>
      {lots.loading && <p role="status">Loading compatible stock lots…</p>}
      {lots.error && (
        <>
          <p role="alert">{lots.error}</p>
          <button type="button" onClick={lots.retry}>Try loading stock lots again</button>
        </>
      )}
      {!lots.loading && !lots.error && compatibleLots.length === 0 && <p>No stock lots match this request.</p>}
      {compatibleLots.length > 0 && (
        <form className="request-form" onSubmit={reserve}>
          <fieldset disabled={submitting} aria-label="Assignment details">
            <label className="request-field">Stock lot
              <select name="lotId" defaultValue="" required>
                <option value="">Select a stock lot</option>
                {compatibleLots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.availableQuantity} {lot.unit} available · {lot.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="request-field">Quantity ({request.unit})
              <input name="quantity" type="number" min={1} max={2_147_483_647} required />
            </label>
            <label className="request-field">Volunteer ID
              <input name="volunteerId" pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"
                maxLength={36} autoComplete="off" spellCheck={false} required />
            </label>
            <label className="request-field">Delivery instructions (optional)
              <textarea name="instructions" maxLength={2000} rows={2} />
            </label>
            <button type="submit">{submitting ? 'Reserving…' : 'Reserve stock'}</button>
          </fieldset>
        </form>
      )}
      {error && <p role="alert">{error.message}</p>}
      {error?.code === 'STALE_VERSION' && <button type="button" onClick={onRefresh}>Reload request</button>}
      {error?.code === 'INSUFFICIENT_STOCK' && (
        <button type="button" disabled={lots.loading || submitting} onClick={lots.refresh}>Refresh stock lots</button>
      )}
      {lots.nextCursor && !lots.error && (
        <button type="button" disabled={lots.loading || submitting} onClick={lots.loadMore}>Load more stock lots</button>
      )}
    </section>
  );
}
