-- Add owner_user_id to images table
-- Links each image to the user who uploaded it (from 20260307_auth.sql, previously unapplied)

ALTER TABLE images
    ADD COLUMN owner_user_id BIGINT UNSIGNED NULL AFTER id,
    ADD KEY idx_images_owner_user_id (owner_user_id),
    ADD CONSTRAINT fk_images_owner_user_id FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE;
