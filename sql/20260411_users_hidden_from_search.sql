-- Add is_hidden_from_search flag to users table
-- When TRUE, the user will not appear in search suggest results.
ALTER TABLE users
    ADD COLUMN is_hidden_from_search TINYINT(1) NOT NULL DEFAULT 0
    AFTER upload_enabled;
