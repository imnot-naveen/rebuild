CREATE TABLE IF NOT EXISTS delivery (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    assignment_id uuid NOT NULL,
    volunteer_id uuid NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (event_id, assignment_id) REFERENCES assignment (event_id, id)
);

CREATE INDEX IF NOT EXISTS delivery_event_assignment_idx ON delivery (event_id, assignment_id);

CREATE INDEX IF NOT EXISTS assignment_event_created_idx
    ON assignment (event_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS assignment_event_volunteer_created_idx
    ON assignment (event_id, volunteer_id, created_at DESC, id DESC);
