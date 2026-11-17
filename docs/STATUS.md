# Rebuild status

- Updated 17 November 2026, Asia/Colombo
- Current milestone M1
- R00 — DONE
- R01 — DONE
- R02a — DONE
- R02b — DONE
- R03 — IN_PROGRESS
- Branch `codex/r03-reporting-access`

## Progress

The [product contract](PRODUCT-CONTRACT.md) and [data and API contract](DATA-API-CONTRACT.md) are merged into `main`. R02a adds a NestJS API and React/Vite app in an npm workspace pinned to Node.js 24.18.1. The [README](../README.md) covers local setup and checks. GitHub Actions builds both apps and runs the smoke tests against the same Compose service used locally.

Naveen chose a microservices backend. The [service boundaries and delivery sequence](ARCHITECTURE.md) are merged into `main`. The existing API is the starting point for Relief Operations.

## Evidence and open decisions

- The shared-lot walkthrough starts with 8 available cases. Two coordinators each try to reserve 5 for different requests. One commits and the other sees 3 available and receives a stock conflict. Exactly one assignment commits.
- The shared-request walkthrough uses two lots and a request with 8 allocatable cases. The first reservation leaves 3. The request row lock and updated request version prevent the second allocation for 5.
- The partial-delivery walkthrough reserves 8 out of 10, delivers 5, cancels to release 3, then reserves and delivers the final 5. Checked the arithmetic against the stock and request invariants. These are design walkthroughs. Database enforcement and integration checks follow in R02, R05 and R07.
- On 12 November, `npm ci` and `npm run build` passed. The API development and compiled start commands served `/health`, and the Vite development command served the web page. Docker Compose started a healthy PostgreSQL 17.11 and PostGIS 3.7.0 database. `npm test` verified `GET /health` returned HTTP 200 and used node-postgres to insert a geography point, read it back and evaluate `ST_DWithin`.
- Practical independent confirmation sources for live relief remain an organizer validation item.
- Traced reservation, delivery and cancellation against the proposed boundaries. Relief Operations owns each complete transaction. Matching can be unavailable while coordinators allocate manually. Confirm the Access failure behavior, target surge workload, hosting budget and revised delivery estimate during the architecture review and first cross-service slice.

## Learning and time

Naveen identified the need for mutually exclusive access to the shared stock lot and serialized updates to the same request across different lots. The assistant drafted the contract and reviewed consistent lock acquisition, version conflicts and automatic release at transaction end. Focused time was not measured. The R01 allowance was two hours.

The assistant implemented and verified the routine R02a scaffolding. The R02a allowance was one hour. For R02b, Naveen wrote and corrected the transaction test. The assistant explained client checkout, SQL parameter binding and the expected rows after rollback, then reviewed and ran the test.

## Next action

Review and merge the R03 backend PR targeting `main`. The request list and resident browser screens are the next R03 slice. Reassess hosted preview provisioning and the delivery estimate once the workflow runs through the browser.

## R03 lookup review · 17 November 2026

- Naveen wrote the category join and bound the request, event and authenticated resident IDs as parameters. The first review identified mismatched SQL identifiers, a checked-out client that needs to be returned to the pool, and the missing conversion from a row to `RequestDetail`. The lookup remains Naveen's exercise.
- The API compiled. Against disposable PostgreSQL 17.6 and PostGIS 3.7.0, the R03 integration test returned `500` for both the owner and the other resident because PostgreSQL could not find `assistance_requests`. Submission, retry handling and the Access outage check passed. The test timed out during teardown with a client still checked out.
- Naveen switched to `pool.query` and corrected the query identifiers and aliases. The next integration run shut down cleanly. The owner received `200`, and the other resident, another event and an unknown request ID each received `404`. The owner response body assertion still failed at that point. The assistant provided examples for projecting the missing columns and mapping the row to `RequestDetail`.
- Naveen completed the detail projection and returned `null` for an empty result. The assistant typed the database row and cleaned up formatting. `npm run db:migrate` and all 10 tests in `npm test` passed against PostgreSQL 17.6 and PostGIS 3.7.0. The owner receives the complete response including the exact location. The three denied lookups return `404`.

## R03 preparation · 15 November 2026

- The assistant added the Access service entry point and database-backed event membership check, separate Access and Operations migrations, and the resident submission endpoint. A submission persists the request, audit entry and idempotency response in one database transaction.
- The detail endpoint calls Access and delegates to the repository exercise. The handoff test expects the owner to get `200` and another resident in the same event to get `404`. R03 remains in progress pending the lookup and browser workflow.
- Both workspace builds passed. `npm run db:migrate` succeeded with separate Access and Operations databases and credentials. The full API suite ran against a disposable native PostgreSQL 17.6 and PostGIS 3.7.0 instance because Docker Desktop's Linux engine was unavailable.
- The four R02 checks and four R03 subtests passed. R03 verified persistence and audit ownership, concurrent same-key replay, invalid-input rejection, conflict and revoked-role handling, and `503` when Access was unavailable. The owner-detail assertion returned `404` instead of `200` at the deliberate lookup stub. Rerun after the exercise to verify owner and non-owner behavior together.
- Work is isolated on the R03 branch from `main` after PR #7. The next PR covers this backend slice after Naveen implements the lookup and the assistant reviews it.

## R02b session · 13 November 2026

- Naveen's [transaction test](../apps/api/test/transaction.test.cjs) verified that row 1 survives `COMMIT` and row 2 disappears after `ROLLBACK`, using one checked-out client. The first attempts exposed duplicate declarations and a mismatched SQL parameter index. After those fixes, `npm test` passed all four tests against the local PostGIS database.
- The assistant added the JWT smoke endpoint and verified RS256 signature, issuer, audience, expiry and subject using locally signed fixtures and a simulated signing-key endpoint. A missing or invalid token returns `401`, and an unavailable signing-key endpoint returns `503`. The workspace build and PostGIS smoke test passed.
- Built the Linux API image with `docker build -f apps/api/Dockerfile -t rebuild-api:r02b .`. On Docker Desktop, it ran as the `node` user and returned `200` from `/health` and `401` from `/auth/check` without a token. A local idle sample reported about 41 MiB of container memory.
- Naveen configured the Auth0 development tenant and React SPA. The assistant integrated the official React SDK for login, sign-up, profile and logout, configured the public SPA settings in the ignored local Vite environment, and pinned the dev port to 5173. `npm run build` and all four tests passed. The dev server returned HTTP 200 with the SPA settings loaded, and the tenant's OpenID metadata was reachable. Naveen manually verified Google sign-up and logout from the local React app.
- Naveen sent an access token issued by the Auth0 development tenant for the Rebuild API and verified HTTP 204 from the local `GET /auth/check` endpoint. The API also returned HTTP 401 for missing and malformed tokens. The assistant supplied the issuer and audience through the API process environment because Windows denied the write to `.env`. The [README](../README.md#check-auth0-token-validation) includes the token check verified on Windows PowerShell 5.1 and PowerShell 7.
- Hosted preview readiness will be reviewed during the first cross-service slice. Render Free web services cannot receive private network traffic, so the previous single-service preview plan needs a separate deployment decision for Access and Matching.
