import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { coordinatorRequest } from './coordinator-api';
import type { CoordinatorAccess, StockLot, StockLotDetail } from './coordinator-api';
import { useCoordinatorMutation } from './coordinator-mutation';
import { useStockLots } from './stock-lots';

function StockForm({ access, lot, onSaved, onRefresh }: {
  access: CoordinatorAccess;
  lot?: StockLotDetail;
  onSaved: (lot: StockLot) => void;
  onRefresh?: () => void;
}) {
  const { error, submitting, submit } = useCoordinatorMutation(access);
  const [received, setReceived] = useState(String(lot?.receivedQuantity ?? ''));
  const [formError, setFormError] = useState('');
  const adjustsQuantity = lot !== undefined && Number(received) !== lot.receivedQuantity;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? '').trim();
    const location = { latitude: Number(text('latitude')), longitude: Number(text('longitude')) };
    const receivedQuantity = Number(received);
    setFormError('');

    if (!lot) {
      const category = text('category');
      const unit = text('unit');
      if (!category || !unit) {
        setFormError('Enter a category code and unit.');
        return;
      }
      void submit<StockLot>('/stock-lots', 'POST', { category, unit, receivedQuantity, location }, (created) => {
        form.reset();
        setReceived('');
        onSaved(created);
      });
      return;
    }

    const movesLot = location.latitude !== lot.location.latitude || location.longitude !== lot.location.longitude;
    if (!adjustsQuantity && !movesLot) {
      setFormError('Change the received quantity or location before saving.');
      return;
    }
    const reason = text('reason');
    if (adjustsQuantity && !reason) {
      setFormError('Enter a reason for the quantity change.');
      return;
    }
    void submit<StockLot>(`/stock-lots/${lot.id}`, 'PATCH', {
      version: lot.version,
      receivedQuantity: adjustsQuantity ? receivedQuantity : undefined,
      location: movesLot ? location : undefined,
      reason: adjustsQuantity ? reason : undefined,
    }, onSaved);
  }

  return (
    <form className="request-form" onSubmit={save}>
      <fieldset disabled={submitting} aria-label={lot ? 'Stock lot adjustment' : 'New stock lot'}>
        {!lot && (
          <>
            <label className="request-field">Category code
              <input name="category" maxLength={64} placeholder="drinking-water" required />
            </label>
            <label className="request-field">Unit
              <input name="unit" maxLength={64} placeholder="cases" required />
            </label>
          </>
        )}
        <label className="request-field">Received quantity
          <input name="receivedQuantity" type="number" min={lot ? 0 : 1} max={2_147_483_647}
            value={received} onChange={(event) => setReceived(event.target.value)} required />
        </label>
        {adjustsQuantity && (
          <label className="request-field">Reason for quantity change
            <textarea name="reason" maxLength={2000} rows={2} required />
          </label>
        )}
        <div className="request-filters">
          <label className="request-field">Latitude
            <input name="latitude" type="number" min={-90} max={90} step="any"
              defaultValue={lot?.location.latitude} required />
          </label>
          <label className="request-field">Longitude
            <input name="longitude" type="number" min={-180} max={180} step="any"
              defaultValue={lot?.location.longitude} required />
          </label>
        </div>
        <button type="submit">{submitting ? 'Saving…' : lot ? 'Save adjustment' : 'Add stock'}</button>
      </fieldset>
      {(formError || error) && <p role="alert">{formError || error?.message}</p>}
      {error?.code === 'STALE_VERSION' && <button type="button" onClick={onRefresh}>Reload stock lot</button>}
    </form>
  );
}

function LotDetails({ access, id, listedVersion, onChanged }: {
  access: CoordinatorAccess; id: string; listedVersion?: number; onChanged: () => void;
}) {
  const { eventId, getToken } = access;
  const [lot, setLot] = useState<StockLotDetail>();
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void coordinatorRequest<StockLotDetail>({ eventId, getToken }, `/stock-lots/${id}`, signal)
      .then((result) => { if (!signal.aborted) setLot(result); })
      .catch((reason: Error) => { if (!signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [eventId, getToken, id, attempt]);

  function refresh() {
    setLot(undefined);
    setError('');
    setAttempt((value) => value + 1);
  }

  return (
    <section className="request-details" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} ref={heading}>Stock lot details</h3>
      <p className="form-status" role="status">{status}</p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <button type="button" onClick={refresh}>Try again</button>
        </>
      )}
      {lot && (
        <>
          {listedVersion !== undefined && listedVersion > lot.version && (
            <button type="button" onClick={refresh}>Reload updated stock lot</button>
          )}
          <dl>
            <dt>Stock lot ID</dt><dd>{lot.id}</dd>
            <dt>Category</dt><dd>{lot.category}</dd>
            <dt>Available</dt><dd>{lot.availableQuantity} {lot.unit}</dd>
            <dt>Reserved</dt><dd>{lot.reservedQuantity} {lot.unit}</dd>
            <dt>Delivered</dt><dd>{lot.deliveredQuantity} {lot.unit}</dd>
          </dl>
          <h4>Adjust stock</h4>
          <StockForm access={access} lot={lot} onRefresh={refresh} onSaved={(updated) => {
            setStatus(`Stock updated. ${updated.availableQuantity} ${updated.unit} available.`);
            refresh();
            onChanged();
          }} />
        </>
      )}
      {!lot && !error && <p role="status">Loading stock lot…</p>}
    </section>
  );
}

export function Inventory({ revision, onStockChanged, ...access }: CoordinatorAccess & {
  revision: number;
  onStockChanged: () => void;
}) {
  const lots = useStockLots(access, '', revision);
  const [selectedId, setSelectedId] = useState<string>();
  const [status, setStatus] = useState('');

  return (
    <section aria-labelledby="inventory-heading">
      <h2 id="inventory-heading">Inventory</h2>
      <h3>Add stock</h3>
      <StockForm access={access} onSaved={(lot) => {
        setStatus(`Added ${lot.receivedQuantity} ${lot.unit} of ${lot.category}.`);
        onStockChanged();
      }} />
      <p className="form-status" role="status">{status}</p>
      <h3>Stock lots</h3>
      {lots.stockLots.length > 0 && (
        <ul className="requests">
          {lots.stockLots.map((lot) => (
            <li key={lot.id}>
              <button type="button" className="request-link" aria-expanded={selectedId === lot.id}
                onClick={() => setSelectedId(selectedId === lot.id ? undefined : lot.id)}>
                <strong>{lot.category} · {lot.receivedQuantity} {lot.unit}</strong>
                <span>{lot.availableQuantity} available · {lot.reservedQuantity} reserved · {lot.deliveredQuantity} delivered</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lots.loading && <p role="status">Loading stock lots…</p>}
      {lots.error && (
        <>
          <p role="alert">{lots.error}</p>
          <button type="button" onClick={lots.retry}>Try again</button>
        </>
      )}
      {!lots.loading && !lots.error && lots.stockLots.length === 0 && <p>No stock lots for this event yet.</p>}
      {lots.nextCursor && !lots.error && (
        <button type="button" disabled={lots.loading} onClick={lots.loadMore}>Load more stock lots</button>
      )}
      {selectedId && <LotDetails key={selectedId} access={access} id={selectedId}
        listedVersion={lots.stockLots.find((lot) => lot.id === selectedId)?.version} onChanged={onStockChanged} />}
    </section>
  );
}
