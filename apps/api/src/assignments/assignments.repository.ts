import { Injectable } from '@nestjs/common';
import type { PageOptions } from '../operations/input';
import { OperationsDatabase } from '../operations/operations.database';
import type { AssignmentReader } from '../requests/access-client';

export const assignmentStates = ['assigned', 'accepted', 'in_transit', 'completed', 'cancelled'] as const;
export type AssignmentState = typeof assignmentStates[number];

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface AssignmentSummaryRow {
  id: string;
  category: string;
  unit: string;
  state: AssignmentState;
  assignedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  version: number;
  createdAt: Date;
  generalArea: Coordinates;
}

interface AssignmentDetailRow extends AssignmentSummaryRow {
  requestId: string;
  lotId: string;
  volunteerId: string;
  location: Coordinates | null;
  instructions: string | null;
}

const summaryColumns = `a.id, r.category_code AS category, c.unit, a.state,
  a.assigned_quantity AS "assignedQuantity", a.delivered_quantity AS "deliveredQuantity",
  CASE WHEN a.state = 'cancelled' THEN 0 ELSE a.assigned_quantity - a.delivered_quantity END AS "remainingQuantity",
  a.version, a.created_at AS "createdAt",
  json_build_object('latitude', round(ST_Y(r.location::geometry)::numeric, 1),
                    'longitude', round(ST_X(r.location::geometry)::numeric, 1)) AS "generalArea"`;

const visibleAssignments = `FROM assignment a
  JOIN assistance_request r ON r.event_id = a.event_id AND r.id = a.request_id
  JOIN category c ON c.code = r.category_code
  JOIN relief_event e ON e.id = a.event_id AND e.active
  WHERE a.event_id = $1 AND ($2::uuid IS NULL OR a.volunteer_id = $2)`;

@Injectable()
export class AssignmentsRepository {
  constructor(private readonly database: OperationsDatabase) {}

  async list(eventId: string, reader: AssignmentReader, { limit, before }: PageOptions, state?: AssignmentState) {
    const { rows } = await this.database.pool.query<AssignmentSummaryRow & { cursorCreatedAt: string }>(
      `SELECT ${summaryColumns},
              to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
       ${visibleAssignments}
         AND ($3::text IS NULL OR a.state = $3)
         AND ($4::timestamptz IS NULL OR (a.created_at, a.id) < ($4::timestamptz, $5::uuid))
       ORDER BY a.created_at DESC, a.id DESC LIMIT $6`,
      [eventId, reader.role === 'volunteer' ? reader.userId : null, state ?? null, before?.createdAt ?? null,
        before?.id ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = last && rows.length > limit
      ? Buffer.from(`${last.cursorCreatedAt}/${last.id}`).toString('base64url')
      : null;
    return { assignments: page.map(({ cursorCreatedAt, ...assignment }) => assignment), nextCursor };
  }

  async find(eventId: string, assignmentId: string, reader: AssignmentReader) {
    const showDeliveryDetails = `($2::uuid IS NULL OR a.state IN ('accepted', 'in_transit'))`;
    const { rows: [assignment] } = await this.database.pool.query<AssignmentDetailRow>(
      `SELECT ${summaryColumns}, a.request_id AS "requestId", a.stock_lot_id AS "lotId", a.volunteer_id AS "volunteerId",
        CASE WHEN ${showDeliveryDetails} THEN json_build_object('latitude', ST_Y(r.location::geometry),
          'longitude', ST_X(r.location::geometry)) END AS location,
        CASE WHEN ${showDeliveryDetails} THEN a.instructions END AS instructions
       ${visibleAssignments} AND a.id = $3`,
      [eventId, reader.role === 'volunteer' ? reader.userId : null, assignmentId],
    );
    if (!assignment) return null;
    const { requestId, lotId, volunteerId, location, instructions, ...summary } = assignment;
    return {
      ...summary,
      ...(reader.role === 'coordinator' ? { requestId, lotId, volunteerId } : {}),
      ...(location ? { location } : {}),
      ...(instructions ? { instructions } : {}),
    };
  }
}
