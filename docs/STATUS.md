# Rebuild status

- Updated 13 November 2026, Asia/Colombo
- Current milestone M0
- R00 — DONE
- R01 — DONE
- R02a — DONE
- Current task R02b — IN PROGRESS
- Branch `codex/r02b-runtime-checks`

## Progress

The [product contract](PRODUCT-CONTRACT.md) and [data and API contract](DATA-API-CONTRACT.md) are merged into `main`. R02a adds a NestJS API and React/Vite app in an npm workspace pinned to Node.js 24.18.1. The [README](../README.md) covers local setup and checks. GitHub Actions builds both apps and runs the smoke tests against the same Compose service used locally.

## Evidence and open decisions

- The shared-lot walkthrough starts with 8 available cases. Two coordinators each try to reserve 5 for different requests. One commits and the other sees 3 available and receives a stock conflict. Exactly one assignment commits.
- The shared-request walkthrough uses two lots and a request with 8 allocatable cases. The first reservation leaves 3. The request row lock and updated request version prevent the second allocation for 5.
- The partial-delivery walkthrough reserves 8 out of 10, delivers 5, cancels to release 3, then reserves and delivers the final 5. Checked the arithmetic against the stock and request invariants. These are design walkthroughs. Database enforcement and integration checks follow in R02, R05 and R07.
- On 12 November, `npm ci` and `npm run build` passed. The API development and compiled start commands served `/health`, and the Vite development command served the web page. Docker Compose started a healthy PostgreSQL 17.11 and PostGIS 3.7.0 database. `npm test` verified `GET /health` returned HTTP 200 and used node-postgres to insert a geography point, read it back and evaluate `ST_DWithin`.
- R02b still needs to demonstrate explicit transaction commit and rollback. Practical independent confirmation sources for live relief remain an organizer validation item.

## Learning and time

Naveen identified the need for mutually exclusive access to the shared stock lot and serialized updates to the same request across different lots. The assistant drafted the contract and reviewed consistent lock acquisition, version conflicts and automatic release at transaction end. Focused time was not measured. The R01 allowance was two hours.

The assistant implemented and verified the routine R02a scaffolding. The R02a allowance was one hour. Naveen's next implementation exercise is the rollback check using one checked-out database client.

## Next action

Naveen writes `apps/api/test/transaction.test.cjs` with one checked-out PostgreSQL client, an explicit commit, an explicit rollback and assertions on the final rows. Review the attempt and rerun `npm test`. For the live Auth0 check, configure the tenant issuer and API Identifier in the local environment and send a tenant-issued access token to `GET /auth/check`. Reassess hosted preview provisioning during the first cross-service slice.

## R02b session · 13 November 2026

- The assistant added the JWT smoke endpoint and verified RS256 signature, issuer, audience, expiry and subject using locally signed fixtures and a simulated signing-key endpoint. A missing or invalid token returns `401`, and an unavailable signing-key endpoint returns `503`. The workspace build and PostGIS smoke test passed.
- Built the Linux API image with `docker build -f apps/api/Dockerfile -t rebuild-api:r02b .`. On Docker Desktop, it ran as the `node` user and returned `200` from `/health` and `401` from `/auth/check` without a token. A local idle sample reported about 41 MiB of container memory.
- No Auth0 issuer or audience was configured in the local environment, and hosted account readiness was unverified. Live token and hosted deployment checks remain pending. The verifier is a foundation check. Event membership and the independently deployable Access service are planned for the first authenticated workflow.
