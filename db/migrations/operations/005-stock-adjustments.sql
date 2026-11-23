ALTER TABLE audit_entry
    ADD COLUMN IF NOT EXISTS reason text CHECK (length(trim(reason)) BETWEEN 1 AND 2000);
