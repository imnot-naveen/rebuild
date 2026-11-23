import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PageOptions } from '../operations/input';
import { OperationsDatabase } from '../operations/operations.database';
import type { StockAdjustment } from './stock-adjustment';

interface StockLotInput {
  category: string;
  unit: string;
  receivedQuantity: number;
  location: { latitude: number; longitude: number };
}

interface StockLotRow extends Omit<StockLotInput, 'location'> {
  id: string;
  reservedQuantity: number;
  deliveredQuantity: number;
  availableQuantity: number;
  version: number;
  createdAt: Date;
}

const summaryColumns = `id, category_code AS category, unit, received_quantity AS "receivedQuantity",
  reserved_quantity AS "reservedQuantity", delivered_quantity AS "deliveredQuantity",
  received_quantity - reserved_quantity - delivered_quantity AS "availableQuantity",
  version, created_at AS "createdAt"`;

function serialize({ createdAt, ...fields }: StockLotRow) {
  return { ...fields, createdAt: createdAt.toISOString() };
}

@Injectable()
export class StockLotsRepository {
  constructor(private readonly database: OperationsDatabase) {}

  async create(eventId: string, userId: string, key: string, input: StockLotInput) {
    return this.database.mutate(userId, key, `/v1/events/${eventId}/stock-lots`, input, 201, async (client) => {
      await this.database.lockActiveEvent(client, eventId);
      const { category, unit, receivedQuantity, location } = input;
      const inserted = await client.query<StockLotRow>(
        `INSERT INTO stock_lot (event_id, category_code, unit, received_quantity, location)
         SELECT $1, code, unit, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography
           FROM category WHERE code = $2 AND unit = $3 FOR KEY SHARE
         RETURNING ${summaryColumns}`,
        [eventId, category, unit, receivedQuantity, location.longitude, location.latitude],
      );
      const lot = inserted.rows[0];
      if (!lot) throw new BadRequestException('Invalid category and unit combination');

      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, stock_lot_id, operation)
         VALUES ($1, $2, $3, 'stock_lot.create')`,
        [eventId, userId, lot.id],
      );
      return serialize(lot);
    });
  }

  async adjust(eventId: string, lotId: string, userId: string, key: string, input: StockAdjustment) {
    const path = `/v1/events/${eventId}/stock-lots/${lotId}`;
    return this.database.mutate(userId, key, path, input, 200, async (client) => {
      await this.database.lockActiveEvent(client, eventId);
      const { rows: [lot] } = await client.query<StockLotRow>(
        `SELECT ${summaryColumns} FROM stock_lot WHERE event_id = $1 AND id = $2 FOR UPDATE`,
        [eventId, lotId],
      );
      if (!lot) throw new NotFoundException('Stock lot not found');
      if (lot.version !== input.version) {
        throw new ConflictException({
          code: 'STALE_VERSION', message: 'The stock lot version has changed', details: { version: lot.version },
        });
      }
      const { receivedQuantity, location, reason } = input;
      const minimum = lot.reservedQuantity + lot.deliveredQuantity;
      if (receivedQuantity !== undefined && receivedQuantity < minimum) {
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: 'Received quantity cannot be less than the reserved and delivered total',
          details: { minimumReceivedQuantity: minimum },
        });
      }

      const { rows: [updated] } = await client.query<StockLotRow>(
        `UPDATE stock_lot
            SET received_quantity = COALESCE($3, received_quantity),
                location = CASE WHEN $4::double precision IS NULL THEN location
                                ELSE ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography END,
                version = version + 1
          WHERE event_id = $1 AND id = $2
          RETURNING ${summaryColumns}`,
        [eventId, lotId, receivedQuantity, location?.longitude, location?.latitude],
      );
      await client.query(
        `INSERT INTO audit_entry (event_id, actor_id, stock_lot_id, operation, reason)
         VALUES ($1, $2, $3, 'stock_lot.adjust', $4)`,
        [eventId, userId, lotId, reason],
      );
      return serialize(updated);
    }, { method: 'PATCH' });
  }

  async list(eventId: string, { limit, before }: PageOptions, category?: string) {
    const result = await this.database.pool.query<StockLotRow & { cursorCreatedAt: string }>(
      `SELECT ${summaryColumns},
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt"
         FROM stock_lot
        WHERE event_id = $1
          AND ($2::text IS NULL OR category_code = $2)
          AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
        ORDER BY created_at DESC, id DESC
        LIMIT $5`,
      [eventId, category ?? null, before?.createdAt ?? null, before?.id ?? null, limit + 1],
    );
    const page = result.rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = last && result.rows.length > limit
      ? Buffer.from(`${last.cursorCreatedAt}/${last.id}`).toString('base64url')
      : null;
    return { stockLots: page.map(({ cursorCreatedAt, ...row }) => serialize(row)), nextCursor };
  }

  async find(eventId: string, lotId: string) {
    const result = await this.database.pool.query<StockLotRow & { latitude: number; longitude: number }>(
      `SELECT ${summaryColumns}, ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude
         FROM stock_lot WHERE event_id = $1 AND id = $2`,
      [eventId, lotId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const { latitude, longitude, ...lot } = row;
    return { ...serialize(lot), location: { latitude, longitude } };
  }
}
