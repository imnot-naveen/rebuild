CREATE TABLE IF NOT EXISTS app_user (
    id uuid PRIMARY KEY,
    oidc_issuer text NOT NULL,
    oidc_subject text NOT NULL,
    UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE IF NOT EXISTS event_member (
    event_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES app_user (id),
    role text NOT NULL CHECK (role IN ('resident', 'coordinator', 'volunteer')),
    PRIMARY KEY (event_id, user_id)
);
