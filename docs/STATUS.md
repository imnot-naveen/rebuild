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
- Practical independent confirmation sources for live relief remain an organizer validation item.

## Learning and time

Naveen identified the need for mutually exclusive access to the shared stock lot and serialized updates to the same request across different lots. The assistant drafted the contract and reviewed consistent lock acquisition, version conflicts and automatic release at transaction end. Focused time was not measured. The R01 allowance was two hours.

The assistant implemented and verified the routine R02a scaffolding. The R02a allowance was one hour. For R02b, Naveen wrote and corrected the transaction test. The assistant explained client checkout, SQL parameter binding and the expected rows after rollback, then reviewed and ran the test.

## Next action

Exercise sign-up or login and logout in the React app at `http://localhost:5173/`. Register the Rebuild API in the Auth0 development tenant, then configure the issuer and API Identifier locally and send a tenant-issued access token to `GET /auth/check`. Reassess hosted preview provisioning during the first cross-service slice.

## R02b session · 13 November 2026

- Naveen's [transaction test](../apps/api/test/transaction.test.cjs) verified that row 1 survives `COMMIT` and row 2 disappears after `ROLLBACK`, using one checked-out client. The first attempts exposed duplicate declarations and a mismatched SQL parameter index. After those fixes, `npm test` passed all four tests against the local PostGIS database.
- The assistant added the JWT smoke endpoint and verified RS256 signature, issuer, audience, expiry and subject using locally signed fixtures and a simulated signing-key endpoint. A missing or invalid token returns `401`, and an unavailable signing-key endpoint returns `503`. The workspace build and PostGIS smoke test passed.
- Built the Linux API image with `docker build -f apps/api/Dockerfile -t rebuild-api:r02b .`. On Docker Desktop, it ran as the `node` user and returned `200` from `/health` and `401` from `/auth/check` without a token. A local idle sample reported about 41 MiB of container memory.
- Naveen configured the Auth0 development tenant and React SPA. The assistant integrated the official React SDK for login, sign-up, profile and logout, configured the public SPA settings in the ignored local Vite environment, and pinned the dev port to 5173. `npm run build` and all four tests passed. The dev server returned HTTP 200 with the SPA settings loaded, and the tenant's OpenID metadata was reachable. The browser sign-in round trip still needs to be exercised.
- The [README](../README.md#check-auth0-token-validation) documents the remaining API registration and live token check. Hosted preview readiness will be reviewed during the first cross-service slice. Render Free web services cannot receive private network traffic, so the previous single-service preview plan needs a separate deployment decision for Access and Matching.
