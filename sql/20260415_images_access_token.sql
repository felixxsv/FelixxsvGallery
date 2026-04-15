-- Add access_token column for token-based image URL (/img/{token})
ALTER TABLE images
  ADD COLUMN access_token CHAR(16) NOT NULL DEFAULT '' AFTER content_hash;

-- Backfill existing rows with random 16-char hex tokens
UPDATE images SET access_token = LEFT(HEX(RANDOM_BYTES(8)), 16) WHERE access_token = '';

-- Enforce uniqueness
ALTER TABLE images ADD UNIQUE INDEX uq_images_access_token (access_token);

-- Remove the default so future inserts must supply a value
ALTER TABLE images MODIFY COLUMN access_token CHAR(16) NOT NULL;
