import { useEffect, useState, type FormEvent } from 'react';
import { coordinatorRequest, type CoordinatorAccess, type Reservation, type SuggestedLots } from './coordinator-api';
import { useCoordinatorMutation } from './coordinator-mutation';
import type { RequestDetail } from './resident-api';
import { useStockLots } from './stock-lots';

const kilometres = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function AssignmentForm({ access, request, stockRevision, onSaved, onRefresh }: {
  access: CoordinatorAccess;
  request: RequestDetail;
  stockRevision: number;
  onSaved: (reservation: Reservation) => void;
  onRefresh: () => void;
}) {
  const lots = useStockLots(access, request.category, stockRevision);
  const { error, submitting, submit } = useCoordinatorMutation(access);
  const [selectedLot, setSelectedLot] = useState('');
  const [suggestions, setSuggestions] = useState<SuggestedLots>();
  const [suggestionError, setSuggestionError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { eventId, getToken } = access;
  const outdatedSuggestions = suggestions && suggestions.requestVersion !== request.version;
  const suggestedLots = outdatedSuggestions ? [] : suggestions?.candidates ?? [];
  const suggestedIds = new Set(suggestedLots.map((lot) => lot.lotId));
  const manualLots = lots.stockLots.filter((lot) => lot.unit === request.unit && !suggestedIds.has(lot.id));
  const selectedSuggestion = suggestedLots.find((lot) => lot.lotId === selectedLot);
  const selectedAvailable = suggestedIds.has(selectedLot) || manualLots.some((lot) => lot.id === selectedLot);
  const hasLots = suggestedLots.length > 0 || manualLots.length > 0;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setSuggestions(undefined);
    setSuggestionError('');
    void coordinatorRequest<SuggestedLots>({ eventId, getToken },
      `/requests/${encodeURIComponent(request.id)}/matches`, signal)
      .then((result) => {
        if (!signal.aborted) setSuggestions(result);
      })
      .catch((reason: Error) => {
        if (!signal.aborted) setSuggestionError(reason.message);
      });
    return () => controller.abort();
  }, [eventId, getToken, request.id, request.version, stockRevision, attempt]);

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
      {suggestionError ? (
        <>
          <p role="alert">Stock suggestions could not load. {suggestionError} You can select a lot manually.</p>
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry stock suggestions</button>
        </>
      ) : outdatedSuggestions ? (
        <>
          <p role="alert">This request changed while loading stock suggestions.</p>
          <button type="button" onClick={onRefresh}>Reload request for suggestions</button>
        </>
      ) : suggestions ? (
        <p role="status">
          {suggestions.allocatableQuantity === 0 ? 'All confirmed need is allocated or delivered.'
            : suggestedLots.length === 0 ? 'No nearby stock suggestions.'
              : `${suggestions.allocatableQuantity} ${request.unit} still allocatable.`}
        </p>
      ) : <p role="status">Loading stock suggestions…</p>}
      {lots.loading && <p role="status">Loading compatible stock lots…</p>}
      {lots.error && (
        <>
          <p role="alert">{lots.error}</p>
          <button type="button" onClick={lots.retry}>Try loading stock lots again</button>
        </>
      )}
      {!lots.loading && !lots.error && !hasLots && <p>No stock lots match this request.</p>}
      {hasLots && (
        <form className="request-form" onSubmit={reserve}>
          <fieldset disabled={submitting} aria-label="Assignment details">
            <label className="request-field">Stock lot
              <select name="lotId" value={selectedAvailable ? selectedLot : ''} required
                aria-describedby={selectedSuggestion ? 'stock-match-explanation' : undefined}
                onChange={(event) => setSelectedLot(event.target.value)}>
                <option value="">Select a stock lot</option>
                {suggestedLots.length > 0 && (
                  <optgroup label="Suggested lots">
                    {suggestedLots.map((lot) => (
                      <option key={lot.lotId} value={lot.lotId}>
                        {kilometres.format(lot.distanceMetres / 1000)} km · {lot.availableQuantity} {request.unit} available · {lot.lotId}
                      </option>
                    ))}
                  </optgroup>
                )}
                {manualLots.length > 0 && (
                  <optgroup label="Manual stock selection">
                    {manualLots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.availableQuantity} {lot.unit} available · {lot.id}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            {selectedSuggestion && <p id="stock-match-explanation" role="status">{selectedSuggestion.explanation}</p>}
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
