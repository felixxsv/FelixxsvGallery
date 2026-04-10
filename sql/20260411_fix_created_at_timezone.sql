-- Fix created_at timezone: UTC → JST (+9 hours)
-- Background: the server runs in UTC, and MySQL's CURRENT_TIMESTAMP was
-- used as the DEFAULT for created_at. This caused all upload timestamps
-- to be stored 9 hours behind JST. The upload code was fixed to explicitly
-- set created_at to JST, so only existing rows need this one-time correction.
--
-- IMPORTANT: Run this migration ONLY ONCE.
-- Apply AFTER deploying the upload code fix.

UPDATE images
SET created_at = created_at + INTERVAL 9 HOUR;

UPDATE gallery_contents
SET created_at = created_at + INTERVAL 9 HOUR;
