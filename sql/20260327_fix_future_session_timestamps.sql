UPDATE user_sessions
SET last_presence_at = NULL
WHERE last_presence_at IS NOT NULL
  AND last_presence_at > DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE);

UPDATE user_sessions
SET last_access_at = CASE
    WHEN revoked_at IS NOT NULL AND revoked_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN revoked_at
    WHEN last_seen_at IS NOT NULL AND last_seen_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN last_seen_at
    WHEN created_at IS NOT NULL AND created_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN created_at
    ELSE UTC_TIMESTAMP(6)
END
WHERE last_access_at IS NOT NULL
  AND last_access_at > DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE);

UPDATE user_sessions
SET last_seen_at = CASE
    WHEN revoked_at IS NOT NULL AND revoked_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN revoked_at
    WHEN last_access_at IS NOT NULL AND last_access_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN last_access_at
    WHEN created_at IS NOT NULL AND created_at <= DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE) THEN created_at
    ELSE UTC_TIMESTAMP(6)
END
WHERE last_seen_at IS NOT NULL
  AND last_seen_at > DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 5 MINUTE);
