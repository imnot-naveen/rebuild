# Rebuild product contract

R00 design · 10 November 2026

## Demo scope

One fictional flood displaces households in a single district. One fictional relief organization coordinates deliveries. A resident reports a need, a coordinator verifies it and allocates stock, and a volunteer records what reached the household. Use synthetic people, locations, and stock throughout the demo.

For the walkthrough, a household requests sealed cases of drinking water. A coordinator checks that the household can receive a delivery, confirms the need, and dispatches available cases. If a delivery falls short, the resident can see what arrived and the coordinator can arrange another delivery.

Quantities are positive whole numbers with explicit units. Each category has a fixed unit for the prototype, such as cases for drinking water. A stock offer can satisfy a request only when its category and unit both match. Deliveries use the same unit as the request and reservation.

Assumptions to validate with an organizer include which confirmation sources are practical, who can verify a report, when a volunteer needs the exact delivery location, and how volunteers record short deliveries in the field.

## Report and verify

1. A resident supplies the category, quantity, description, and delivery location. The resident can save an account-scoped draft offline and explicitly submit when connected. The request appears as submitted after the server confirms receipt. Retrying the same submission after a lost response produces one request.
2. A coordinator checks the report against the active event and service area, reviews similar reports and prior deliveries for the same need, and seeks independent confirmation from the relief organization. In the demo, a synthetic shelter intake record or a simulated field lead's confirmation can establish the need and delivery location.
3. The coordinator verifies the confirmed quantity and urgency, asks a clarification question if details or confirmation are missing, or rejects the report with a resident-facing reason if it is confirmed ineligible or duplicates an existing report for the same need. The resident can reply on their own report and see its updated status.

Sign-in identifies the account that submitted a report. Each verification records the coordinator, time, source of confirmation, confirmed quantity, and a short rationale in the audit history. Keep internal notes available to coordinators only. The demo uses synthetic confirmation references and collects no identity documents or proof uploads. The server allows matching and stock reservation only for verified requests, using the confirmed quantity as the allocation limit.

Similar descriptions or nearby locations are leads for review. Separate households at one shelter can have similar needs. A coordinator can link related reports while preserving their history. A confirmed duplicate can be linked to the existing report and rejected through the ordinary review action. Suggestions and links leave status and quantities unchanged.

| Request review transition | Actor and trigger |
|---|---|
| Submitted → Needs clarification | Coordinator records a question. |
| Needs clarification → Submitted | Resident submits a reply. |
| Submitted → Verified | Coordinator records the confirmation source, verified quantity, and urgency. |
| Submitted → Rejected | Coordinator records the rejection reason. |

The offline draft lives on the device. The review states above begin when the server records the report. Verified and rejected end the review flow for this prototype. Delivery progress is tracked separately for verified requests.

## Allocate and fulfil

1. The coordinator adds stock and reviews ranked suggestions for a verified request. Suggestions use a snapshot. The coordinator chooses the stock, amount, and volunteer. The system rechecks eligibility and current quantities before creating the assignment, reserving stock, and recording the change together.
2. The assigned volunteer accepts the assignment, marks it in transit, and records the actual delivered quantity. A partial delivery consumes only the quantity delivered. The balance of the reservation stays with the active assignment until it is delivered or the coordinator cancels it.
3. A coordinator can cancel an active assignment. Cancellation releases only its undelivered reservation. The request is fulfilled once cumulative deliveries reach the verified quantity. Any remaining need stays visible to the coordinator and resident.

| Assignment transition | Actor and trigger |
|---|---|
| Assigned → Accepted | Assigned volunteer accepts the work. |
| Accepted → In transit | Assigned volunteer starts the delivery. |
| In transit → In transit | Assigned volunteer records a partial delivery. |
| In transit → Completed | Assigned volunteer delivers the remainder of the assignment. |
| Assigned, Accepted, or In transit → Cancelled | Coordinator cancels and releases the undelivered reservation. |

A completed assignment can leave a request partly fulfilled when the assignment covered only part of the request. Outstanding need equals the verified quantity minus confirmed deliveries. The coordinator can allocate only the part of the outstanding need that active assignments have yet to reserve.

## Role and action matrix

| Action or data | Resident | Coordinator | Volunteer |
|---|---|---|---|
| Create a report, reply to clarification | Own reports | — | — |
| Read request status and delivery progress | Own reports | All reports in the event | Assigned delivery status only |
| Read exact location | Own reports | All reports in the event | Own assignment from acceptance until completion or cancellation |
| Read original description | Own reports | All reports in the event | — |
| Read internal verification notes | — | All reports in the event | — |
| Ask for clarification, verify, reject, or link duplicates | — | All reports in the event | — |
| Maintain stock, review matches, create or cancel assignments | — | All requests and stock in the event | — |
| View assignment details | — | All assignments in the event | Own assignments, with the location rule above |
| Accept, start transit, record delivered quantity | — | — | Own active assignments |

The server enforces role, ownership, and assignment checks. An offer shows the volunteer its category, quantity, and general area. After acceptance, the volunteer gets the exact location and any coordinator-provided delivery instructions while the assignment is active. The resident sees their report and delivery progress. Any public view is limited to aggregate counts.

## Screen sketches

```text
Resident phone
Request help → Enter category, quantity/unit, description and location
             → Save draft offline or submit when connected
My requests  → Request detail with status, clarification reply and delivered/needed

Coordinator
Queue        → Filter by review state and urgency
Request      → Review report, confirmation and related reports → Clarify, verify or reject
             → For verified requests, compare stock → Confirm amount and volunteer
Inventory    → Enter stock and see available/reserved quantities

Volunteer phone
Assignments  → Own offers with quantity and general area → Accept
Delivery     → Exact location and instructions → Start transit → Record quantity
             → See remaining amount or completed delivery
```

## Acceptance walkthrough

- A resident saves a draft, submits after reconnecting, answers a clarification, and sees the verified request. An invalid quantity is rejected. A different resident cannot open the request by ID.
- A plausible report with no corroboration stays unverified and cannot reserve stock. The coordinator can record a synthetic confirmation and verify the need. A confirmed duplicate links to the existing report and is rejected with a reason. Two corroborated reports for separate households at the same shelter can both be verified.
- A coordinator verifies the category, unit, and urgency, compares suitable stock, and assigns a volunteer. If available stock falls below the requested allocation after ranking, the system reports a conflict without creating an assignment or changing quantities.
- The assigned volunteer gets the exact location after accepting, records a short delivery, and sees the undelivered amount. Another volunteer cannot access the assignment. Retrying the same delivery operation leaves delivered and reserved totals unchanged.
- Cancelling a partially delivered assignment releases only the undelivered reservation. A new assignment can cover the remaining need. Once the full quantity is delivered, the resident sees the request as fulfilled.
