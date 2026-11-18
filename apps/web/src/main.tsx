import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { Fragment, StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RequestHelp } from './request-help';
import { ResidentRequests } from './resident-requests';
import './styles.css';

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN;
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const eventId = import.meta.env.VITE_RELIEF_EVENT_ID;
const homeUrl = new URL('/', window.location.origin).href;

function Account() {
  const {
    isLoading, isAuthenticated, error, user, loginWithRedirect, logout, getAccessTokenSilently,
  } = useAuth0();
  const getToken = useCallback(() => getAccessTokenSilently(), [getAccessTokenSilently]);

  const [requestListVersion, setRequestListVersion] = useState(0);

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
          <Fragment key={user?.sub}>
            <RequestHelp
              eventId={eventId}
              getToken={getToken}
              onSubmitted={() => setRequestListVersion((previous) => previous + 1)}
            />
            <ResidentRequests key={requestListVersion} eventId={eventId} getToken={getToken} />
          </Fragment>
        ) : (
          <p role="status">The relief event or API audience has not been configured.</p>
        )}
      </>
    );
  }

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
