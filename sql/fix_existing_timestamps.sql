START TRANSACTION;

UPDATE user_sessions
SET
  created_at = created_at - INTERVAL 9 HOUR,
  last_seen_at = last_seen_at - INTERVAL 9 HOUR
WHERE gallery = 'vrchat';

UPDATE audit_logs
SET created_at = created_at - INTERVAL 9 HOUR
WHERE created_at > UTC_TIMESTAMP() - INTERVAL 120 DAY;

COMMIT;
