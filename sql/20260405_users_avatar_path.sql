-- Add avatar_path to users table
-- Stores relative path to user's uploaded avatar image

ALTER TABLE users
    ADD COLUMN avatar_path VARCHAR(500) NULL AFTER display_name;
