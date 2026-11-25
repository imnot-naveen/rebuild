import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { PageOptions } from '../operations/input';
import { OperationsDatabase } from '../operations/operations.database';
import type { AssignmentReader } from '../requests/access-client';
import { nextAssignmentState } from './assignment-command';
import type { AssignmentCommand, AssignmentState } from './assignment-command';

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

interface AssignmentParents {
  requestId: string;
  lotId: string;
}

type AssignmentBalance = Pick<AssignmentSummaryRow, 'id' | 'version' | 'state' | 'assignedQuantity' | 'deliveredQuantity'>;

const balanceColumns = `id, version, state, assigned_quantity AS "assignedQuantity",
  delivered_quantity AS "deliveredQuantity"`;

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

  async mutate(eventId: string, id: string, userId: string, key: string, command: AssignmentCommand) {
    const { action } = command;
    const path = `/v1/events/${eventId}/assignments/${id}/${action}`;
    const volunteerId = action === 'cancellation' ? null : userId;
    const changesBalance = action === 'deliveries' || action === 'cancellation';
    const checkReplay = async (client: PoolClient) => {
      await this.database.lockActiveEvent(client, eventId);
      await this.findParents(client, eventId, id, volunteerId);
    };

    return this.database.mutate(userId, key, path, command, action === 'deliveries' ? 201 : 200, async (client) => {
      await this.database.lockActiveEvent(client, eventId);
      const parents = changesBalance ? await this.findParents(client, eventId, id, volunteerId) : undefined;
      if (parents) {
        // Follow reservation's request → lot order before taking the assignment lock.
        await client.query('SELECT id FROM assistance_request WHERE event_id = $1 AND id = $2 FOR NO KEY UPDATE',
          [eventId, parents.requestId]);
        await client.query('SELECT id FROM stock_lot WHERE event_id = $1 AND id = $2 FOR NO KEY UPDATE',
          [eventId, parents.lotId]);
      }

      const { rows: [current] } = await client.query<AssignmentBalance>(
        `SELECT ${balanceColumns} FROM assignment
          WHERE event_id = $1 AND id = $2 AND ($3::uuid IS NULL OR volunteer_id = $3)
          FOR NO KEY UPDATE`, [eventId, id, volunteerId],
      );
      if (!current) throw new NotFoundException('Assignment not found');

      const state = nextAssignmentState(command, current);
      const delivered = action === 'deliveries' ? command.quantity : 0;
      const { rows: [updated] } = await client.query<AssignmentBalance>(
        `UPDATE assignment SET state = $3, delivered_quantity = delivered_quantity + $4, version = version + 1
          WHERE event_id = $1 AND id = $2 RETURNING ${balanceColumns}`, [eventId, id, state, delivered],
      );

      if (parents) {
        const released = action === 'cancellation' ? current.assignedQuantity - current.deliveredQuantity : delivered;
        await client.query(
          `UPDATE stock_lot SET reserved_quantity = reserved_quantity - $3,
             delivered_quantity = delivered_quantity + $4, version = version + 1
           WHERE event_id = $1 AND id = $2`, [eventId, parents.lotId, released, delivered],
        );
        await client.query(
          `UPDATE assistance_request SET version = version + 1, updated_at = clock_timestamp()
           WHERE event_id = $1 AND id = $2`, [eventId, parents.requestId],
        );
      }

      // State-only actions audit the assignment without taking parent foreign-key locks.
      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, request_id, stock_lot_id, assignment_id, operation, reason, review_state)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [eventId, userId, parents?.requestId, parents?.lotId, id, `assignment.${action}`,
          action === 'cancellation' ? command.reason : null, parents ? 'verified' : null],
      );
      const assignment = {
        ...updated,
        remainingQuantity: state === 'cancelled' ? 0 : updated.assignedQuantity - updated.deliveredQuantity,
      };
      if (action !== 'deliveries') return assignment;

      const { rows: [delivery] } = await client.query<{ id: string; quantity: number; recordedAt: Date }>(
        `INSERT INTO delivery (event_id, assignment_id, volunteer_id, quantity) VALUES ($1, $2, $3, $4)
         RETURNING id, quantity, recorded_at AS "recordedAt"`, [eventId, id, userId, delivered],
      );
      return { assignment, delivery: { ...delivery, recordedAt: delivery.recordedAt.toISOString() } };
    }, { checkReplay });
  }

  private async findParents(client: PoolClient, eventId: string, id: string, volunteerId: string | null) {
    const { rows: [parents] } = await client.query<AssignmentParents>(
      `SELECT request_id AS "requestId", stock_lot_id AS "lotId" FROM assignment
        WHERE event_id = $1 AND id = $2 AND ($3::uuid IS NULL OR volunteer_id = $3)`, [eventId, id, volunteerId],
    );
    if (!parents) throw new NotFoundException('Assignment not found');
    return parents;
  }

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
