CREATE UNIQUE INDEX IF NOT EXISTS assistance_request_event_id_id_idx
    ON assistance_request (event_id, id);

ALTER TABLE assistance_request
    ADD COLUMN IF NOT EXISTS verified_quantity integer,
    ADD COLUMN IF NOT EXISTS verified_urgency text CONSTRAINT assistance_request_verified_fields_check CHECK (
        CASE WHEN review_state = 'verified' THEN
            verified_quantity IS NOT NULL AND verified_quantity > 0 AND
            verified_urgency IS NOT NULL AND verified_urgency IN ('routine', 'urgent', 'critical')
        ELSE verified_quantity IS NULL AND verified_urgency IS NULL END
    ),
    ADD COLUMN IF NOT EXISTS duplicate_of_request_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'assistance_request'::regclass AND conname = 'assistance_request_duplicate_fk'
    ) THEN
        ALTER TABLE assistance_request
            ADD CONSTRAINT assistance_request_duplicate_fk FOREIGN KEY (event_id, duplicate_of_request_id)
                REFERENCES assistance_request (event_id, id),
            ADD CONSTRAINT assistance_request_duplicate_check CHECK (
                duplicate_of_request_id IS NULL OR (review_state = 'rejected' AND duplicate_of_request_id <> id)
            );
    END IF;
END; $$;

CREATE TABLE IF NOT EXISTS request_activity (
    request_id uuid NOT NULL,
    event_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    request_version integer NOT NULL CHECK (request_version > 1),
    action text NOT NULL CHECK (action IN ('clarify', 'reply', 'verify', 'reject', 'link')),
    message text,
    confirmed_quantity integer CHECK (confirmed_quantity > 0),
    urgency text CHECK (urgency IN ('routine', 'urgent', 'critical')),
    source_type text CHECK (source_type IN ('shelter_intake', 'field_lead')),
    source_reference text,
    rationale text,
    related_request_id uuid,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (request_id, request_version),
    FOREIGN KEY (event_id, request_id) REFERENCES assistance_request (event_id, id),
    FOREIGN KEY (event_id, related_request_id) REFERENCES assistance_request (event_id, id)
);
