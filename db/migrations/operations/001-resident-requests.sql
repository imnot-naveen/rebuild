CREATE TABLE IF NOT EXISTS relief_event (
    id uuid PRIMARY KEY,
    active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS category (
    code text PRIMARY KEY,
    unit text NOT NULL
);

CREATE TABLE IF NOT EXISTS assistance_request (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES relief_event (id),
    resident_id uuid NOT NULL,
    category_code text NOT NULL REFERENCES category (code),
    requested_quantity integer NOT NULL CHECK (requested_quantity > 0),
    description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 2000),
    location geography(Point, 4326) NOT NULL,
    review_state text NOT NULL DEFAULT 'submitted' CHECK (
        review_state IN ('submitted', 'needs_clarification', 'verified', 'rejected')
    ),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_entry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES relief_event (id),
    actor_id uuid NOT NULL,
    request_id uuid NOT NULL REFERENCES assistance_request (id),
    operation text NOT NULL,
    review_state text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_record (
    actor_id uuid NOT NULL,
    operation_key text NOT NULL,
    fingerprint text NOT NULL,
    response_status smallint,
    response_body jsonb,
    CHECK ((response_status IS NULL) = (response_body IS NULL)),
    PRIMARY KEY (actor_id, operation_key)
);
