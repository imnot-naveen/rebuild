# Rebuild

Rebuild is a relief coordination prototype. See the [product contract](docs/PRODUCT-CONTRACT.md), [data and API contract](docs/DATA-API-CONTRACT.md), and [project status](docs/STATUS.md).

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

## Check Auth0 token validation

Register a Rebuild API with RS256 under **Applications → APIs** in the Auth0 Dashboard. Set `AUTH0_ISSUER` in `.env` to the exact issuer URL with its trailing slash and `AUTH0_AUDIENCE` to the API Identifier. Start or restart the local API with `npm run dev:api`. For the Docker run, pass the two values from your environment with `-e AUTH0_ISSUER -e AUTH0_AUDIENCE` before the image name.

Get an access token for the Rebuild API from the API's **Test** tab. This PowerShell 7 check prompts for the token without echoing it and sends it only to the local API.

```powershell
$rebuildAccessToken = Read-Host 'Paste the Rebuild API access token' -AsSecureString
try {
  (Invoke-WebRequest -Uri 'http://127.0.0.1:3000/auth/check' `
    -Authentication Bearer -Token $rebuildAccessToken `
    -AllowUnencryptedAuthentication -SkipHttpErrorCheck).StatusCode
} finally {
  $rebuildAccessToken.Dispose()
}
```

A valid token receives `204`. Missing and invalid tokens receive `401`. A signing-key outage or missing configuration returns `503` when a bearer token is supplied. The smoke route checks token validity. Event membership and role checks belong to the Access service in the first authenticated workflow.
