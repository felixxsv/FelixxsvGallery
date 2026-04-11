-- Backfill: set is_email_verified=TRUE for existing Discord users
-- Discord users created before Option A were registered with is_email_verified=FALSE,
-- but Discord email is considered trusted so no verification step is needed.
-- Target: users who have an enabled Discord auth_identity and is_email_verified=FALSE.
UPDATE users u
INNER JOIN auth_identities ai
    ON ai.user_id = u.id
    AND ai.provider = 'discord'
    AND ai.is_enabled = TRUE
SET u.is_email_verified = TRUE
WHERE u.is_email_verified = FALSE;
