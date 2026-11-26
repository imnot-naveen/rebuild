ALTER TABLE audit_entry DROP CONSTRAINT IF EXISTS audit_entry_subject_check;

ALTER TABLE audit_entry ADD CONSTRAINT audit_entry_subject_check CHECK (
    (request_id IS NULL) = (review_state IS NULL) AND
    (request_id IS NOT NULL OR stock_lot_id IS NOT NULL OR assignment_id IS NOT NULL)
);
