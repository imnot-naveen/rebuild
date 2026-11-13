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
