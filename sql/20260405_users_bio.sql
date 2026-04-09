-- Add bio column to users table for user profile self-introduction
ALTER TABLE users
    ADD COLUMN bio VARCHAR(300) NULL AFTER avatar_path;
