import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssignmentWorkspace } from './assignment-workspace';
import { coordinatorRequest } from './coordinator-api';
import { Inventory } from './inventory';
import { RequestHelp } from './request-help';
import type { GetToken, ReviewRole } from './resident-api';
import { RequestWorkspace } from './resident-requests';
import { useOnline } from './connectivity';
import './styles.css';

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN;
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const eventId = import.meta.env.VITE_RELIEF_EVENT_ID;
const homeUrl = new URL('/', window.location.origin).href;
type EventRole = ReviewRole | 'volunteer';

function EventRequests({ eventId, getToken }: { eventId: string; getToken: GetToken }) {
  const [access, setAccess] = useState<EventRole>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [requestListVersion, setRequestListVersion] = useState(0);
  const [coordinatorView, setCoordinatorView] = useState<'queue' | 'inventory' | 'assignments'>('queue');
  const [stockRevision, setStockRevision] = useState(0);
  const refreshStock = () => setStockRevision((value) => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    void coordinatorRequest<{ role: EventRole }>({ eventId, getToken }, '/access', controller.signal)
      .then(({ role }) => {
        if (!controller.signal.aborted) setAccess(role);
      })
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [eventId, getToken, attempt]);

  if (error) return (
    <>
      <p role="alert">{error}</p>
      <button type="button" onClick={() => { setError(''); setAttempt((value) => value + 1); }}>Try again</button>
    </>
  );
  if (!access) return <p role="status">Checking event access…</p>;
  if (access === 'coordinator') return (
    <>
      <nav className="coordinator-nav" aria-label="Coordinator workspace">
        <button type="button" aria-pressed={coordinatorView === 'queue'} onClick={() => setCoordinatorView('queue')}>
          Requests
        </button>
        <button type="button" aria-pressed={coordinatorView === 'inventory'} onClick={() => setCoordinatorView('inventory')}>
          Inventory
        </button>
        <button type="button" aria-pressed={coordinatorView === 'assignments'} onClick={() => setCoordinatorView('assignments')}>
          Assignments
        </button>
      </nav>
      <div hidden={coordinatorView !== 'queue'}>
        <RequestWorkspace eventId={eventId} getToken={getToken} role={access}
          stockRevision={stockRevision} onReserved={refreshStock} />
      </div>
      <div hidden={coordinatorView !== 'inventory'}>
        <Inventory eventId={eventId} getToken={getToken} revision={stockRevision} onStockChanged={refreshStock} />
      </div>
      <div hidden={coordinatorView !== 'assignments'}>
        <AssignmentWorkspace eventId={eventId} getToken={getToken} role={access} revision={stockRevision}
          onChanged={refreshStock} />
      </div>
    </>
  );
  if (access === 'volunteer') return <AssignmentWorkspace eventId={eventId} getToken={getToken} role={access} />;
  return (
    <>
      <RequestHelp eventId={eventId} getToken={getToken}
        onSubmitted={() => setRequestListVersion((previous) => previous + 1)} />
      <RequestWorkspace key={requestListVersion} eventId={eventId} getToken={getToken} role={access} />
    </>
  );
}

function Account() {
  const {
    isLoading, isAuthenticated, error, user, loginWithRedirect, logout, getAccessTokenSilently,
  } = useAuth0();
  const online = useOnline();
  const getToken = useCallback(() => getAccessTokenSilently(), [getAccessTokenSilently]);

  if (isLoading) {
    return <p role="status">Checking your sign-in status…</p>;
  }

  if (isAuthenticated) {
    return (
      <>
        <div className="account">
          <div>
            {user?.name || user?.email || 'Signed in'}
            {user?.name && user.email && user.email !== user.name && <div>{user.email}</div>}
          </div>
          <button type="button" onClick={() => void logout({ logoutParams: { returnTo: homeUrl } })}>
            Log out
          </button>
        </div>
        {auth0Audience && eventId ? (
          <EventRequests key={user?.sub} eventId={eventId} getToken={getToken} />
        ) : (
          <p role="status">The relief event or API audience has not been configured.</p>
        )}
      </>
    );
  }

  if (!online) return <p role="status">You’re offline. Reconnect and sign in to open your saved draft.</p>;

  return (
    <>
      {error && <p role="alert">{error.message}</p>}
      <button type="button" onClick={() => void loginWithRedirect()}>
        Log in
      </button>{' '}
      <button
        type="button"
        onClick={() => void loginWithRedirect({ authorizationParams: { screen_hint: 'signup' } })}
      >
        Sign up
      </button>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>Rebuild</h1>
      {auth0Domain && auth0ClientId ? (
        <Auth0Provider
          domain={auth0Domain}
          clientId={auth0ClientId}
          authorizationParams={{ redirect_uri: homeUrl, audience: auth0Audience || undefined }}
        >
          <Account />
        </Auth0Provider>
      ) : (
        <p role="status">Sign-in has not been configured.</p>
      )}
    </main>
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('Could not enable the offline app shell.', error);
  });
}
