ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS last_access_at DATETIME(6) NULL AFTER last_seen_at,
  ADD COLUMN IF NOT EXISTS last_presence_at DATETIME(6) NULL AFTER last_access_at;

UPDATE user_sessions
SET last_access_at = COALESCE(last_access_at, last_seen_at)
WHERE last_access_at IS NULL;
