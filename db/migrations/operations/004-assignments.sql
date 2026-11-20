CREATE TABLE IF NOT EXISTS assignment (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    request_id uuid NOT NULL,
    stock_lot_id uuid NOT NULL,
    volunteer_id uuid NOT NULL,
    state text NOT NULL DEFAULT 'assigned' CHECK (
        state IN ('assigned', 'accepted', 'in_transit', 'completed', 'cancelled')
    ),
    assigned_quantity integer NOT NULL CHECK (assigned_quantity > 0),
    delivered_quantity integer NOT NULL DEFAULT 0 CHECK (delivered_quantity >= 0),
    instructions text CHECK (length(trim(instructions)) BETWEEN 1 AND 2000),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (event_id, id),
    FOREIGN KEY (event_id, request_id) REFERENCES assistance_request (event_id, id),
    FOREIGN KEY (event_id, stock_lot_id) REFERENCES stock_lot (event_id, id),
    CHECK (delivered_quantity <= assigned_quantity),
    CHECK ((state = 'completed') = (delivered_quantity = assigned_quantity))
);

CREATE INDEX IF NOT EXISTS assignment_event_request_idx ON assignment (event_id, request_id);

ALTER TABLE audit_entry ADD COLUMN IF NOT EXISTS assignment_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_entry'::regclass AND conname = 'audit_entry_assignment_fk'
    ) THEN
        ALTER TABLE audit_entry
            ADD CONSTRAINT audit_entry_assignment_fk FOREIGN KEY (event_id, assignment_id)
                REFERENCES assignment (event_id, id);
    END IF;
END; $$;
