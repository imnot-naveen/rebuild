import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { OperationsDatabase } from '../operations/operations.database';
import { assignmentTotalsSql } from '../requests/allocation';
import type { ReviewState } from '../requests/report';
import { matchCandidateLimit, matchRadiusMetres, type MatchCandidate } from './snapshot';

type SnapshotRow = {
  requestVersion: number;
  reviewState: ReviewState;
  allocatableQuantity: number;
} & (MatchCandidate | { lotId: null; availableQuantity: null; distanceMetres: null });

@Injectable()
export class MatchSnapshotsRepository {
  constructor(private readonly database: OperationsDatabase) {}

  async read(eventId: string, requestId: string) {
    const { rows } = await this.database.matchingPool.query<SnapshotRow>(
      `WITH request AS (
         SELECT r.version, r.review_state, r.event_id, r.category_code, c.unit, r.location,
                GREATEST(0, r.verified_quantity - totals.delivered - totals.held)::integer AS allocatable
           FROM assistance_request r
           JOIN relief_event e ON e.id = r.event_id AND e.active
           JOIN category c ON c.code = r.category_code
           CROSS JOIN (${assignmentTotalsSql}) totals
          WHERE r.event_id = $1 AND r.id = $2
       )
       SELECT r.version AS "requestVersion", r.review_state AS "reviewState",
              r.allocatable AS "allocatableQuantity", nearby.id AS "lotId",
              nearby.available AS "availableQuantity", nearby.distance AS "distanceMetres"
         FROM request r
         LEFT JOIN LATERAL (
           SELECT l.id, l.received_quantity - l.reserved_quantity - l.delivered_quantity AS available,
                  l.location <-> r.location AS distance
             FROM stock_lot l
            WHERE r.review_state = 'verified' AND r.allocatable > 0
              AND l.event_id = r.event_id AND l.category_code = r.category_code AND l.unit = r.unit
              AND l.received_quantity - l.reserved_quantity - l.delivered_quantity > 0
              AND ST_DWithin(l.location, r.location, $3, false)
            ORDER BY distance, l.id
            LIMIT $4
         ) nearby ON true`,
      [eventId, requestId, matchRadiusMetres, matchCandidateLimit],
    ).catch((error: unknown) => {
      if (error instanceof Error && ('code' in error || error.message.includes('timeout'))) {
        throw new ServiceUnavailableException('Stock suggestions are temporarily unavailable');
      }
      throw error;
    });

    const request = rows[0];
    if (!request) throw new NotFoundException('Request not found');
    if (request.reviewState !== 'verified') {
      throw new ConflictException({ code: 'REQUEST_NOT_VERIFIED', message: 'Only verified requests can be matched' });
    }

    const candidates: MatchCandidate[] = [];
    for (const { lotId, availableQuantity, distanceMetres } of rows) {
      if (lotId !== null) candidates.push({ lotId, availableQuantity, distanceMetres });
    }
    return { requestVersion: request.requestVersion, allocatableQuantity: request.allocatableQuantity, candidates };
  }
}
