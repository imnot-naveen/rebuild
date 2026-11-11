# Rebuild status

- Updated 11 November 2026, Asia/Colombo
- Current milestone M0
- R00 — DONE
- R01 — DONE
- Next task R02a — TODO
- Branch `codex/r01-data-api-contract`

## Progress

R00's product contract is merged into `main`. The [R01 data and API contract](DATA-API-CONTRACT.md) defines the data model, review and assignment states, role-scoped endpoints, quantity invariants, version conflicts and idempotency. The persistence choice is parameterized SQL through node-postgres with PostGIS for spatial filtering.

## Evidence and open decisions

- The shared-lot walkthrough starts with 8 available cases. Two coordinators each try to reserve 5 for different requests. One commits and the other sees 3 available and receives a stock conflict. Exactly one assignment commits.
- The shared-request walkthrough uses two lots and a request with 8 allocatable cases. The first reservation leaves 3. The request row lock and updated request version prevent the second allocation for 5.
- The partial-delivery walkthrough reserves 8 out of 10, delivers 5, cancels to release 3, then reserves and delivers the final 5. Checked the arithmetic against the stock and request invariants. These are design walkthroughs. Database enforcement and integration checks follow in R02, R05 and R07.
- R02 still needs to validate node-postgres transactions and the PostGIS image in the runnable foundation. Practical independent confirmation sources for live relief remain an organizer validation item.

## Learning and time

Naveen identified the need for mutually exclusive access to the shared stock lot and serialized updates to the same request across different lots. The assistant drafted the contract and reviewed consistent lock acquisition, version conflicts and automatic release at transaction end. Focused time was not measured. The R01 allowance was two hours.

## Next action

R02a is the one-hour runnable foundation slice. Scaffold the minimal NestJS and React workspace, PostgreSQL/PostGIS Compose service and CI. Verify one HTTP endpoint and a real database write and read.
