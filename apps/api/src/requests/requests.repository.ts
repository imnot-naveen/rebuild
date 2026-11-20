import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { PageOptions } from '../operations/input';
import { OperationsDatabase } from '../operations/operations.database';
import { RequestReader } from './access-client';
import { ReportInput, RequestDetail, RequestSummary, ReviewState } from './report';
import { nextReviewState, type ReviewCommand, type Urgency } from './review';

type RequestSummaryRow = Omit<RequestSummary, 'createdAt' | 'verifiedQuantity' | 'verifiedUrgency'> & {
  createdAt: Date;
  verifiedQuantity?: number | null;
  verifiedUrgency?: Urgency | null;
};

type RequestDetailRow = RequestSummaryRow & Pick<RequestDetail, 'description' | 'activity'> & {
  latitude: number;
  longitude: number;
};

function summarize({ createdAt, verifiedQuantity, verifiedUrgency, ...fields }: RequestSummaryRow): RequestSummary {
  return {
    ...fields,
    createdAt: createdAt.toISOString(),
    ...(verifiedQuantity != null && verifiedUrgency != null ? { verifiedQuantity, verifiedUrgency } : {}),
  };
}

@Injectable()
export class RequestsRepository {
  constructor(private readonly database: OperationsDatabase) {}

  async create(eventId: string, userId: string, key: string, input: ReportInput): Promise<RequestSummary> {
    return this.database.mutate(userId, key, `/v1/events/${eventId}/requests`, input, 201, async (client) => {
      await this.database.lockActiveEvent(client, eventId);
      const category = await client.query(
        'SELECT code FROM category WHERE code = $1 AND unit = $2 FOR SHARE',
        [input.category, input.unit],
      );
      if (category.rowCount === 0) {
        throw new BadRequestException('Invalid category and unit combination');
      }

      const inserted = await client.query<Omit<RequestSummaryRow, 'unit'>>(
        `INSERT INTO assistance_request (
           event_id, resident_id, category_code, requested_quantity, description, location
         )
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         RETURNING id, category_code AS category, requested_quantity AS quantity,
                   review_state AS "reviewState", version, created_at AS "createdAt"`,
        [eventId, userId, input.category, input.quantity, input.description,
          input.location.longitude, input.location.latitude],
      );
      const response = summarize({ ...inserted.rows[0], unit: input.unit });

      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, request_id, operation, review_state)
         VALUES ($1, $2, $3, 'request.create', $4)`,
        [eventId, userId, response.id, response.reviewState],
      );
      return response;
    });
  }

  async review(
    eventId: string, requestId: string, userId: string, key: string, route: string, command: ReviewCommand,
  ): Promise<RequestSummary> {
    const path = `/v1/events/${eventId}/requests/${requestId}/${route}`;
    const checkReplay = command.action === 'reply' ? async (client: PoolClient) => {
      const owned = await client.query(
        'SELECT 1 FROM assistance_request WHERE event_id = $1 AND id = $2 AND resident_id = $3',
        [eventId, requestId, userId],
      );
      if (owned.rowCount === 0) throw new NotFoundException('Request not found');
    } : undefined;

    return this.database.mutate(userId, key, path, command, 200, async (client) => {
      await this.database.lockActiveEvent(client, eventId);
      const locked = await client.query<Pick<RequestSummary, 'version' | 'reviewState'>>(
        `SELECT version, review_state AS "reviewState"
           FROM assistance_request
          WHERE event_id = $1 AND id = $2 AND ($3::boolean OR resident_id = $4)
          FOR NO KEY UPDATE`,
        [eventId, requestId, command.action !== 'reply', userId],
      );
      const current = locked.rows[0];
      if (!current) throw new NotFoundException('Request not found');

      const state = nextReviewState(command.action, current, command.version);
      const verification = command.action === 'verify' ? command : undefined;
      const duplicateId = command.action === 'reject' ? command.duplicateId : undefined;
      const relatedId = command.action === 'link' ? command.relatedId : duplicateId;
      if (relatedId) {
        if (relatedId === requestId) throw new BadRequestException('A request cannot link to itself');
        const related = await client.query('SELECT 1 FROM assistance_request WHERE event_id = $1 AND id = $2',
          [eventId, relatedId]);
        if (related.rowCount === 0) throw new NotFoundException('Related request not found');
      }

      const updated = await client.query<RequestSummaryRow>(
        `UPDATE assistance_request r
            SET review_state = $3, version = r.version + 1, updated_at = clock_timestamp(),
                verified_quantity = COALESCE($4, r.verified_quantity),
                verified_urgency = COALESCE($5, r.verified_urgency),
                duplicate_of_request_id = COALESCE($6, r.duplicate_of_request_id)
           FROM category c
          WHERE r.event_id = $1 AND r.id = $2 AND c.code = r.category_code
          RETURNING r.id, r.version, c.code AS category, c.unit, r.requested_quantity AS quantity,
                    r.review_state AS "reviewState", r.created_at AS "createdAt",
                    r.verified_quantity AS "verifiedQuantity", r.verified_urgency AS "verifiedUrgency"`,
        [eventId, requestId, state, verification?.quantity, verification?.urgency, duplicateId],
      );
      const response = summarize(updated.rows[0]);

      await client.query(
        `INSERT INTO request_activity (
           request_id, event_id, actor_id, request_version, action, message, confirmed_quantity,
           urgency, source_type, source_reference, rationale, related_request_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [requestId, eventId, userId, response.version, command.action, 'message' in command ? command.message : null,
          verification?.quantity, verification?.urgency, verification?.sourceType, verification?.reference,
          verification?.rationale, relatedId],
      );
      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, request_id, operation, review_state)
         VALUES ($1, $2, $3, $4, $5)`,
        [eventId, userId, requestId, `request.${command.action}`, state],
      );
      return response;
    }, checkReplay);
  }

  async findVisibleRequest(
    eventId: string,
    requestId: string,
    reader: RequestReader,
  ): Promise<RequestDetail | null> {
    const result = await this.database.pool.query<RequestDetailRow>(
      `SELECT r.id, r.version, r.description, c.code AS category, c.unit,
              r.requested_quantity AS quantity, r.review_state AS "reviewState",
              r.created_at AS "createdAt",
              r.verified_quantity AS "verifiedQuantity", r.verified_urgency AS "verifiedUrgency",
              ST_Y(r.location::geometry) AS latitude,
              ST_X(r.location::geometry) AS longitude,
              COALESCE((
                SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'version', a.request_version, 'action', a.action, 'createdAt', a.created_at,
                  'text', a.message, 'confirmedQuantity', a.confirmed_quantity, 'urgency', a.urgency,
                  'actorId', CASE WHEN $3::boolean THEN a.actor_id END,
                  'source', CASE WHEN $3::boolean AND a.source_type IS NOT NULL
                    THEN jsonb_build_object('type', a.source_type, 'reference', a.source_reference) END,
                  'rationale', CASE WHEN $3::boolean THEN a.rationale END,
                  'relatedRequestId', CASE WHEN $3::boolean THEN a.related_request_id END
                )) ORDER BY a.request_version)
                FROM request_activity a
                WHERE a.request_id = r.id AND ($3::boolean OR a.action <> 'link')
              ), '[]'::jsonb) AS activity
         FROM assistance_request r
         JOIN category c ON r.category_code = c.code
        WHERE r.id = $1 AND r.event_id = $2
          AND ($3::boolean OR r.resident_id = $4)`,
      [requestId, eventId, reader.role === 'coordinator', reader.userId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const { description, activity, latitude, longitude, ...summary } = row;

    return {
      ...summarize(summary),
      description,
      activity,
      location: { latitude, longitude },
    };
  }

  async listVisibleRequests(
    eventId: string,
    reader: RequestReader,
    { limit, before }: PageOptions,
    reviewState?: ReviewState,
    urgency?: Urgency,
  ) {
    const result = await this.database.pool.query<RequestSummaryRow & { cursorCreatedAt: string }>(
      `SELECT r.id, r.version, c.code AS category, c.unit,
              r.requested_quantity AS quantity, r.review_state AS "reviewState",
              r.created_at AS "createdAt",
              r.verified_quantity AS "verifiedQuantity", r.verified_urgency AS "verifiedUrgency",
              to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
         FROM assistance_request r
         JOIN category c ON r.category_code = c.code
        WHERE r.event_id = $1
          AND ($2::boolean OR r.resident_id = $3)
          AND ($4::text IS NULL OR r.review_state = $4)
          AND ($5::text IS NULL OR r.verified_urgency = $5)
          AND ($6::timestamptz IS NULL OR (r.created_at, r.id) < ($6::timestamptz, $7::uuid))
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT $8`,
      [eventId, reader.role === 'coordinator', reader.userId, reviewState ?? null, urgency ?? null,
        before?.createdAt ?? null, before?.id ?? null, limit + 1],
    );

    const page = result.rows.slice(0, limit);
    const requests = page.map(({ cursorCreatedAt, ...row }) => summarize(row));
    const last = page.at(-1);
    // Keep PostgreSQL's microseconds in the cursor. JavaScript Date retains milliseconds.
    const nextCursor = last && result.rows.length > limit
      ? Buffer.from(`${last.cursorCreatedAt}/${last.id}`).toString('base64url')
      : null;
    return { requests, nextCursor };
  }
}
