# Rebuild

Rebuild is a relief coordination prototype. See the [product contract](docs/PRODUCT-CONTRACT.md), [proposed microservices architecture](docs/ARCHITECTURE.md), [data and API contract](docs/DATA-API-CONTRACT.md), and [project status](docs/STATUS.md).

## Run locally

Use the Node.js version in `.nvmrc` and Docker with Compose v2. Run the commands from the repository root.

```powershell
Copy-Item .env.example .env
npm ci
docker compose up -d --wait
```

On macOS or Linux, use `cp .env.example .env` for the first command. The example credentials are for the local database. If you change `POSTGRES_PORT` or `POSTGRES_PASSWORD`, update `DATABASE_URL` to match.

In two terminals, run `npm run dev:api` and `npm run dev:web`. The API responds at `http://localhost:3000/health`. The web app runs at `http://localhost:5173` by default.

Run `npm run build` to compile both apps and `npm start --workspace @rebuild/api` to start the compiled API. With the database running, `npm test` checks the NestJS health endpoint and writes and reads a geography point using PostGIS. The smoke test uses a temporary table that PostgreSQL drops when the connection closes.

Run `docker compose down` to stop the database and retain its named volume.

## Run the API image

Build from the repository root and publish the container port on loopback.

```powershell
docker build -f apps/api/Dockerfile -t rebuild-api .
docker run --rm -p 127.0.0.1:3000:3000 rebuild-api
```

Open `http://localhost:3000/health`. If port 3000 is occupied, change the host port in the mapping and in the URL.

## Try Auth0 sign-in in the web app

Register a React Single Page Application in Auth0. Set its callback and logout URLs to `http://localhost:5173/` and its allowed web origin to `http://localhost:5173`. In `apps/web`, copy `.env.example` to `.env.local` and fill in `VITE_AUTH0_DOMAIN` with the tenant domain and `VITE_AUTH0_CLIENT_ID` with the SPA's Client ID. These values are public browser configuration.

Run `npm run dev:web` from the repo root and open `http://localhost:5173/`. Choose **Sign up** or **Log in** to open Auth0 Universal Login. After returning, check that the profile appears, then select **Log out**. Vite uses port 5173 and stops if that port is already occupied.

## Run the reporting and review backend

Copy `.env.example` to `.env` or add the new `ACCESS_*` settings to your existing `.env`. Then run `docker compose up -d --wait` and `npm run db:migrate` from the repository root. To start both servers manually, set `ACCESS_INTERNAL_KEY` to the same locally generated secret for both processes. For example, generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Access defaults to loopback on port 3001. Start it with `npm run dev:access` and start Operations in a second terminal with `npm run dev:api`.

The integration test provisions temporary schemas and synthetic event memberships in the two databases. It uses signed test tokens, so no Auth0 account setup is needed to run it:

```powershell
npm run build --workspace @rebuild/api
npm run test:r03 --workspace @rebuild/api
```

The test covers persisted submissions, retry behavior, role and event access, and concurrent review actions. Another resident, another event, and an unknown request ID each receive `404` when outside the caller's visibility.

## Try the request and review screens

In `apps/web/.env.local`, set `VITE_AUTH0_AUDIENCE` to the API Identifier used for `AUTH0_AUDIENCE` in the backend and `VITE_RELIEF_EVENT_ID` to the UUID of the local synthetic event. The Operations database needs that event, and the Access database needs an `app_user` whose issuer and subject match the resident's Auth0 identity and an `event_member` row for the event with role `resident`.

Start Access, Operations and Vite, then sign in as that resident. Use **Request help** to submit a synthetic report. Enter a category and unit configured in Operations, such as `drinking-water` and `cases` if that pair is seeded. After submission, **My requests** refreshes. Select the report to see its description and coordinates. If the response is lost, submit the same report again from the same open form to retry with the original key.

Seed a second Auth0 identity and give it a `coordinator` membership for the same event. Sign in as that coordinator and open the report in **Coordinator queue**. Ask for clarification, sign back in as the resident and reply, then verify the request as the coordinator with a confirmed quantity, urgency and synthetic source reference. The resident sees the resulting status and activity. The confirmation source and rationale are visible to coordinators. If a review conflicts with a newer version, refresh the request details and review the current state before submitting again.

Vite proxies `/v1` to Operations at `http://127.0.0.1:3000` during development. A deployed frontend needs a same-origin route for `/v1` through the gateway.

## Check Auth0 token validation

Register a Rebuild API with RS256 under **Applications → APIs** in the Auth0 Dashboard. Set `AUTH0_ISSUER` in `.env` to the exact issuer URL with its trailing slash and `AUTH0_AUDIENCE` to the API Identifier. Start or restart the local API with `npm run dev:api`. For the Docker run, pass the two values from your environment with `-e AUTH0_ISSUER -e AUTH0_AUDIENCE` before the image name.

Get an access token for the Rebuild API from the API's **Test** tab. This check works in Windows PowerShell 5.1 and PowerShell 7. It prompts for the token without echoing it and sends it only to the local API.

```powershell
$rebuildAccessToken = Read-Host 'Paste the Rebuild API access token' -AsSecureString
try {
  $credential = [pscredential]::new('rebuild', $rebuildAccessToken)
  $headers = @{ Authorization = 'Bearer ' + $credential.GetNetworkCredential().Password }
  (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/auth/check' `
    -Headers $headers -UseBasicParsing -MaximumRedirection 0 -ErrorAction Stop).StatusCode
} catch {
  if ($_.Exception.Response) {
    [int]$_.Exception.Response.StatusCode
  } else {
    throw
  }
} finally {
  $rebuildAccessToken.Dispose()
  Remove-Variable headers, credential -ErrorAction SilentlyContinue
}
```

A valid token receives `204`. Missing and invalid tokens receive `401`. A signing-key outage or missing configuration returns `503` when a bearer token is supplied. The smoke route checks token validity. Event membership and role checks belong to the Access service in the first authenticated workflow.
