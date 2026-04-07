-- Add preferred language to users table for cross-device language sync
ALTER TABLE users
    ADD COLUMN preferred_language VARCHAR(16) NULL AFTER bio;
