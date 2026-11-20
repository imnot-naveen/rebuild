CREATE UNIQUE INDEX IF NOT EXISTS category_code_unit_idx ON category (code, unit);

CREATE TABLE IF NOT EXISTS stock_lot (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES relief_event (id),
    category_code text NOT NULL,
    unit text NOT NULL,
    location geography(Point, 4326) NOT NULL,
    received_quantity integer NOT NULL CHECK (received_quantity >= 0),
    reserved_quantity integer NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    delivered_quantity integer NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, id),
    FOREIGN KEY (category_code, unit) REFERENCES category (code, unit),
    CHECK (reserved_quantity::bigint + delivered_quantity <= received_quantity)
);

CREATE INDEX IF NOT EXISTS stock_lot_event_created_id_idx ON stock_lot (event_id, created_at DESC, id DESC);

ALTER TABLE audit_entry
    ALTER COLUMN request_id DROP NOT NULL,
    ALTER COLUMN review_state DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS stock_lot_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_entry'::regclass AND conname = 'audit_entry_stock_lot_fk'
    ) THEN
        ALTER TABLE audit_entry
            ADD CONSTRAINT audit_entry_stock_lot_fk FOREIGN KEY (event_id, stock_lot_id)
                REFERENCES stock_lot (event_id, id),
            ADD CONSTRAINT audit_entry_subject_check CHECK (
                (request_id IS NULL) = (review_state IS NULL) AND
                (request_id IS NOT NULL OR stock_lot_id IS NOT NULL)
            );
    END IF;
END; $$;
