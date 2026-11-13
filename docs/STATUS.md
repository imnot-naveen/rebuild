# Rebuild status

- Updated 13 November 2026, Asia/Colombo
- Current milestone M0
- R00 — DONE
- R01 — DONE
- R02a — DONE
- Next task R02b — TODO
- Branch `codex/microservices-architecture`

## Progress

The [product contract](PRODUCT-CONTRACT.md) and [data and API contract](DATA-API-CONTRACT.md) are merged into `main`. R02a adds a NestJS API and React/Vite app in an npm workspace pinned to Node.js 24.18.1. The [README](../README.md) covers local setup and checks. GitHub Actions builds both apps and runs the smoke tests against the same Compose service used locally.

Naveen chose a microservices backend. The assistant drafted the [service boundaries and delivery sequence](ARCHITECTURE.md) for review. The R02a foundation is merged and serves as the starting point for Relief Operations. Service separation is planned.

## Evidence and open decisions

- The shared-lot walkthrough starts with 8 available cases. Two coordinators each try to reserve 5 for different requests. One commits and the other sees 3 available and receives a stock conflict. Exactly one assignment commits.
- The shared-request walkthrough uses two lots and a request with 8 allocatable cases. The first reservation leaves 3. The request row lock and updated request version prevent the second allocation for 5.
- The partial-delivery walkthrough reserves 8 out of 10, delivers 5, cancels to release 3, then reserves and delivers the final 5. Checked the arithmetic against the stock and request invariants. These are design walkthroughs. Database enforcement and integration checks follow in R02, R05 and R07.
- On 12 November, `npm ci` and `npm run build` passed. The API development and compiled start commands served `/health`, and the Vite development command served the web page. Docker Compose started a healthy PostgreSQL 17.11 and PostGIS 3.7.0 database. `npm test` verified `GET /health` returned HTTP 200 and used node-postgres to insert a geography point, read it back and evaluate `ST_DWithin`.
- R02b still needs to demonstrate explicit transaction commit and rollback. Practical independent confirmation sources for live relief remain an organizer validation item.
- Traced reservation, delivery and cancellation against the proposed boundaries. Relief Operations owns each complete transaction. Matching can be unavailable while coordinators allocate manually. Confirm the Access failure behavior, target surge workload, hosting budget and revised delivery estimate during the architecture review and first cross-service slice.

## Learning and time

Naveen identified the need for mutually exclusive access to the shared stock lot and serialized updates to the same request across different lots. The assistant drafted the contract and reviewed consistent lock acquisition, version conflicts and automatic release at transaction end. Focused time was not measured. The R01 allowance was two hours.

The assistant implemented and verified the routine R02a scaffolding. The R02a allowance was one hour. Naveen's next implementation exercise is the rollback check using one checked-out database client.

## Next action

Review the proposed service boundaries, then continue R02b with Auth0 token validation, explicit commit and rollback, and the Linux runtime for Relief Operations. Use the first authenticated workflow to verify the Access boundary and update the hosting and delivery estimates.
