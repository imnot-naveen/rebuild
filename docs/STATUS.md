# Rebuild status

- Updated 23 November 2026, Asia/Colombo
- Current milestone M2
- R00 — DONE
- R01 — DONE
- R02a — DONE
- R02b — DONE
- R03 — DONE
- R04 — DONE
- R05 — DONE
- R06 — TODO
- Branch `codex/r05-coordinator-inventory`

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

Start R06 with Naveen's TypeScript ranking policy. For a request that needs eight cases, compare a lot two kilometres away with three available cases and a lot six kilometres away with eight. Decide how coverage and distance should affect the order, and specify how equal scores break ties. Freeze those expectations in fixtures before connecting the PostGIS candidate query and Matching service.

## R05 closeout · 23 November 2026

- Started from `origin/main` at `15d4fbd` after [PR #12](https://github.com/imnot-naveen/rebuild/pull/12) merged. The assistant completed the coordinator Inventory and reservation screens and extended the existing transaction pattern to adjust quantity and location. A lot reduction checks the current version and reserved plus delivered quantity under the lot lock. The audit reason and retry response commit with the adjustment. Coordinators select a compatible lot and supply the event volunteer's application user ID.
- Both workspace builds passed. Migrations succeeded twice against disposable PostgreSQL 17.6 with PostGIS 3.7.0. All 24 API checks passed, including the committed version of the rollback exercise. The two pre-existing local test edits were kept out of the change. Added checks for an audited quantity adjustment to zero, location-only updates, role and event scope, concurrent replay, stale versions, and a stock reduction racing a reservation.
- Chrome at 390 px used synthetic identities with the real Access and Operations services. A coordinator added nine cases, adjusted the lot to eight and changed its location. Two coordinators opened different verified requests with the same eight-case stock snapshot. The first reservation committed five cases. Its response was withheld and the browser retried with the same key. The second coordinator saw a stock conflict and refreshed to three available cases. PostGIS showed one assignment and five reserved cases. The resident session showed My requests.
- R05 acceptance is complete locally. The hosted Auth0 tenant walkthrough remains open. R06 will add ranked suggestions to the manual stock selection flow.

## R05 reservation checkpoint · 20 November 2026

- At Naveen's request, the assistant finished the reservation API around his request-locking helper. Operations checks the coordinator and proposed volunteer through Access, then locks the request, reads assignment totals in a separate statement and locks the lot. Stock, request and assignment versions, audit and the replay response commit together. The API replays an authorized operation even if the proposed volunteer's role changes later.
- Both workspace builds passed. All 22 API checks passed against disposable PostgreSQL 17.6 and PostGIS 3.7.0, including the committed rollback test. Migrations succeeded twice. Two coordinators reserving 5 cases each from the same lot of 8 committed one assignment and left 3 cases. The shared-request race returned a stale version and a retry showed 3 allocatable cases. An injected audit failure rolled back every write, and a serialization failure retried with the same key.
- The backend reservation examples are demonstrated. R05 remains in progress for stock adjustments and the coordinator browser workflow.

## M1 review · 20 November 2026

- The resident report, coordinator verification and resident status workflow passed locally using synthetic identities with the real Access and Operations services. The hosted Auth0 tenant walkthrough and deployment remain open. Access already returns a retryable failure when it cannot establish permissions.
- Keep Cloudflare Pages and Neon/PostGIS as the free preview candidates. Render Free web services cannot receive private network traffic. For M4, test a single public preview container with Access and Matching bound to loopback and separate database credentials. This preview would share one deployment and rollback while preserving the service boundaries. Check combined memory, a cold start, the deployed sign-in workflow and private routing before publishing the demo. No cloud resources were provisioned for this review. [Cloudflare limits](https://developers.cloudflare.com/pages/platform/limits/) · [Neon plans](https://neon.com/docs/introduction/plans) · [Neon PostGIS](https://neon.com/docs/extensions/postgis) · [Render Free limits](https://render.com/docs/free)
- The remaining base estimate is 64 focused hours. Allocate 8 to M2, 10 to M3, 12 to M4, 8 to M5, 10 to M6 and 16 to M7. Move two hours from M2 to the M4 preview spike because the reservation API is already demonstrated and packaging multiple processes adds work. The December and January targets are unchanged. Actual focused hours were unmeasured, and the January allocation still depends on the research schedule.

## R05 inventory kickoff · 20 November 2026

- Started from `origin/main` at `8fc831a` after [PR #11](https://github.com/imnot-naveen/rebuild/pull/11) merged. The assistant added coordinator-only stock entry, paginated inventory reads and detail with exact location. Stock creation persists the lot, audit entry and idempotency response together. Database constraints enforce the category-unit pair and keep reserved plus delivered within the received quantity.
- Both workspace builds passed. The migrations succeeded twice against disposable PostgreSQL 17.6 and PostGIS 3.7.0. All 16 API checks passed, using the committed rollback test because the local exercise copy has a SQL typo. The stock integration case covers concurrent replay, changed payloads, rollback of an invalid stock entry, event and role scope, pagination and rejection of an over-capacity balance.
- Naveen identified that the second attempt in the shared-lot example must roll back when insufficient stock remains. The assistant reviewed the request-first, lot-second lock order and the availability check after waiting. With 8 cases and two attempts for 5, exactly one assignment can commit and 3 cases remain available.
- Naveen added the request-locking helper in `RequestsRepository` using the assistant's example. The assistant corrected the class method declaration and exception import. The API build passed, and direct checks with a stub transaction client covered the verified, missing, stale and unverified cases.
- The assignment transaction, stock adjustments and the inventory browser panel are open. R05 acceptance still requires volunteer eligibility, reservation rollback, and contention across both a shared lot and a shared request.

## R04 review workflow closeout · 19 November 2026

- At Naveen's request, the assistant finished the review transaction and browser workflow using his clarification, reply and stale-version checks. Operations serializes writes to the same request and commits its state, version, activity, audit and idempotency response together. The coordinator can clarify, verify, reject a duplicate or link a related report. The owning resident can answer a clarification and see the updated status and resident-visible history.
- The demo uses routine, urgent and critical urgency, with synthetic shelter intake records and field lead confirmations. Confirm the urgency scale and independent confirmation sources with an organizer before live use. The local Auth0 audience and event still need configuration for a live tenant walkthrough.
- Both workspace builds passed. Migrations succeeded twice against disposable PostgreSQL 17.6 and PostGIS 3.7.0. All 15 API checks passed, using the committed rollback test because the working copy has a SQL typo. The R04 cases verify concurrent requests, safe replay, revoked roles, resident ownership, urgency filtering, and verification note privacy.
- Headless Chrome at 390 px used synthetic RS256 identities against the real Access and Operations services. A coordinator asked a question, the resident replied, and the coordinator verified the request. The resident saw the updated status and confirmed quantity, and the confirmation reference and rationale only appeared for the coordinator.

## R04 coordinator review kickoff · 19 November 2026

- Started from `origin/main` at `cc118c5` after [PR #10](https://github.com/imnot-naveen/rebuild/pull/10) merged.
- The assistant wired the coordinator's event-wide queue and detail through the existing Access and Operations endpoints. `GET /v1/events/{eventId}/requests` accepts `reviewState` alongside the existing pagination parameters. Residents still read only their own reports. Added an integration case for event and role scope, the filter and the list projection.
- Both workspace builds and the database migrations passed. Against disposable PostgreSQL 17.6 and PostGIS 3.7.0, 12 of 13 checks passed, including the new coordinator case. The only failure was the existing uncommitted SQL typo in the rollback test. Both pre-existing local test edits were preserved.
- Naveen wrote the clarification, reply, and version checks in [review.ts](../apps/api/src/requests/review.ts) with step-by-step coaching. The API build passed. Direct assertions verified both allowed transitions, a stale version, and an invalid transition at the current version. The helper still needs to be called by the database write path.
- Review writes, activity history, the verified urgency filter and the browser workflow remain open. Agree on the urgency values and confirmation-source fields during the transition review. The local web Auth0 audience and synthetic event ID still need configuration for live tenant verification. Revisit hosted preview provisioning and the delivery estimate at the M1 review.

## R03 browser verification · 18 November 2026

- Naveen wrote the starter quantity field. At his request, the assistant finished the form and submit handler for this session. The browser validates all six fields, sends the bearer token and idempotency key, and refreshes My requests on success. The same open form retains its values and key when a response is lost.
- Both workspace builds and all 12 API checks passed against temporary PostgreSQL 17.6 and PostGIS 3.7.0. The committed transaction test was run separately. Docker Desktop still returned HTTP 500.
- Chrome at 390 px ran the signed-in screens with synthetic RS256 resident tokens through the real Access and Operations services. Invalid input showed field and service errors. After the first successful response was withheld, the retry reused the same key and PostGIS contained one report. The owner could open the detail after reload, and a second resident received 404. This demonstrates R03 acceptance. The live Auth0 tenant browser check remains separate and needs the local audience and seeded event configuration.

## R03 resident browser kickoff · 18 November 2026

- Started `codex/r03-resident-browser` from `main` at `28d64e0`, after both [PR #8](https://github.com/imnot-naveen/rebuild/pull/8) and [PR #9](https://github.com/imnot-naveen/rebuild/pull/9) merged.
- The assistant wired the Auth0 API audience and same-origin request client, added Vite's local Operations proxy, and built the mobile **My requests** list and detail panel with cursor pagination.
- `npm run build` passed, as did the existing health and JWT checks. Headless Chrome with a synthetic identity and API responses verified bearer headers, opening an owned detail, keyboard focus on its heading, loading another page, and the unavailable state for a detail returning `404`.
- Docker Desktop's Linux engine returned HTTP 500 on its info endpoint. Live Auth0 browser verification against Access, Operations and PostGIS, including persisted submission, remains open. The merged API integration tests cover validation and denied access.
- Naveen's exercise is the **Request help** form. Use category, unit, whole-number quantity, description, latitude and longitude. Convert quantity and coordinates to numbers and show field errors. Submit to `POST /v1/events/{eventId}/requests` with a bearer token and an `Idempotency-Key`. Reuse that key when retrying the same payload after an uncertain response. Once a submission returns `201`, reopen **My requests** and confirm the new request appears after a reload.
- Naveen wrote the starter quantity field. The assistant moved it to the web workspace and mounted it in the signed-in screen in the canonical checkout. After syncing dependencies to the lockfile, both workspace builds passed. A Chrome smoke with synthetic sign-in confirmed the form and its quantity label appear above My requests. The original checkout still needs the Auth0 API audience and synthetic event ID for the live browser check. Next, Naveen adds quantity validation.

## R03 request list kickoff · 17 November 2026

- [PR #8](https://github.com/imnot-naveen/rebuild/pull/8) is merged into `main`. Its checks cover persisted submissions and detail access for the owner.
- The assistant prepared an integration case with two residents in one event and one resident in two events. It expects the list to return only the authenticated resident's summary for the selected event, without the description or coordinates.
- Naveen's exercise is the parameterized list query and its ownership filter. Reuse the database-owned role check from the detail endpoint. The API contract uses descending `(createdAt, id)` order with an opaque cursor. The proposed list response is `{ requests, nextCursor }`, with `nextCursor` set to `null` on the last page.
- Naveen wrote the category join and bound both the event and resident IDs. The API build passed. The assistant reviewed the query and identified the remaining summary projection, sort order and empty-array behavior. The HTTP integration case still awaits the collection route.
- Naveen added deterministic ordering and empty-array behavior. The API still builds. The assistant traced the serializer and found that the list still includes the description and exact location. The SQL projection and row mapping need to match `RequestSummary` before the route is wired up.
- Naveen simplified the timestamp mapping. The assistant removed the description and coordinate columns from the list projection and corrected the query row type. The API built, and the repository query passed against PostgreSQL 17.6 with PostGIS 3.7.0. It returned only the selected resident and event's summary and returned `[]` for an empty scope. The HTTP integration case remains pending the collection route.
- The assistant wired the collection route through Access and added cursor pagination with the contract's 25 default and 100 maximum. The cursor preserves PostgreSQL microseconds and the request ID. `npm run db:migrate` and all 12 tests in `npm test` passed against PostgreSQL 17.6 with PostGIS 3.7.0. The HTTP cases cover resident and event isolation, missing authentication, missing membership, an empty page, malformed pagination, and pagination across tied timestamps and distinct timestamps within one millisecond.

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
