import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const auth0Domain = import.meta.env.VITE_AUTH0_DOMAIN;
const auth0ClientId = import.meta.env.VITE_AUTH0_CLIENT_ID;
const homeUrl = new URL('/', window.location.origin).href;

function Account() {
  const { isLoading, isAuthenticated, error, user, loginWithRedirect, logout } = useAuth0();

  if (isLoading) {
    return <p role="status">Checking your sign-in status…</p>;
  }

  if (isAuthenticated) {
    return (
      <section aria-labelledby="profile-heading">
        <h2 id="profile-heading">User profile</h2>
        {user?.name && <p>{user.name}</p>}
        {user?.email && <p>{user.email}</p>}
        <button type="button" onClick={() => void logout({ logoutParams: { returnTo: homeUrl } })}>
          Log out
        </button>
      </section>
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
      {auth0Domain && auth0ClientId && (
        <Auth0Provider
          domain={auth0Domain}
          clientId={auth0ClientId}
          authorizationParams={{ redirect_uri: homeUrl }}
        >
          <Account />
        </Auth0Provider>
      )}
    </main>
  </StrictMode>,
);
