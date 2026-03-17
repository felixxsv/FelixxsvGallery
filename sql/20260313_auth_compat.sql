ALTER TABLE users
    ADD COLUMN status ENUM('active', 'locked', 'disabled', 'deleted') NOT NULL DEFAULT 'active' AFTER role,
    ADD COLUMN is_email_verified TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
    ADD COLUMN must_reset_password TINYINT(1) NOT NULL DEFAULT 0 AFTER is_email_verified,
    ADD COLUMN force_logout_after DATETIME(6) NULL AFTER must_reset_password,
    ADD COLUMN deleted_at DATETIME(6) NULL AFTER force_logout_after;

UPDATE users
SET status = CASE
    WHEN is_disabled = 1 THEN 'disabled'
    ELSE 'active'
END;

ALTER TABLE user_sessions
    ADD COLUMN two_factor_verified_at DATETIME(6) NULL AFTER expires_at,
    ADD COLUMN two_factor_remember_until DATETIME(6) NULL AFTER two_factor_verified_at,
    ADD COLUMN revoked_at DATETIME(6) NULL AFTER two_factor_remember_until;

CREATE TABLE auth_identities (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(50) NOT NULL,
    provider_user_id VARCHAR(255) NULL,
    provider_email VARCHAR(255) NULL,
    provider_display_name VARCHAR(255) NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    linked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_auth_identities_provider_user (provider, provider_user_id),
    UNIQUE KEY uq_auth_identities_user_provider (user_id, provider),
    KEY idx_auth_identities_user_id (user_id),
    CONSTRAINT fk_auth_identities_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_credentials (
    user_id BIGINT UNSIGNED NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    password_updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    KEY idx_password_credentials_locked_until (locked_until),
    CONSTRAINT fk_password_credentials_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE email_verifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(255) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    purpose ENUM('signup', 'email_signup', 'email_change', '2fa_setup') NOT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_email_verifications_user_purpose_active (user_id, purpose, consumed_at, expires_at, created_at),
    KEY idx_email_verifications_expires_at (expires_at),
    CONSTRAINT fk_email_verifications_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE password_reset_tokens (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    requested_ip VARCHAR(64) NULL,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_password_reset_tokens_token_hash (token_hash),
    KEY idx_password_reset_tokens_user_active (user_id, consumed_at, expires_at, created_at),
    KEY idx_password_reset_tokens_expires_at (expires_at),
    CONSTRAINT fk_password_reset_tokens_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE two_factor_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    method VARCHAR(50) NOT NULL DEFAULT 'email',
    is_enabled TINYINT(1) NOT NULL DEFAULT 0,
    is_required TINYINT(1) NOT NULL DEFAULT 0,
    enabled_at DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id),
    CONSTRAINT fk_two_factor_settings_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE two_factor_challenges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    session_id VARCHAR(64) NULL,
    purpose VARCHAR(50) NOT NULL,
    code_hash CHAR(64) NOT NULL,
    attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME(6) NOT NULL,
    consumed_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_two_factor_challenges_user_purpose_active (user_id, purpose, consumed_at, expires_at, created_at),
    KEY idx_two_factor_challenges_session_id (session_id),
    KEY idx_two_factor_challenges_expires_at (expires_at),
    CONSTRAINT fk_two_factor_challenges_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_invites (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    issued_by_user_id BIGINT UNSIGNED NULL,
    invite_code VARCHAR(128) NOT NULL,
    email VARCHAR(255) NULL,
    role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
    status ENUM('pending', 'used', 'revoked', 'expired') NOT NULL DEFAULT 'pending',
    expires_at DATETIME(6) NOT NULL,
    used_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_invites_invite_code (invite_code),
    KEY idx_user_invites_status (status),
    KEY idx_user_invites_email (email),
    CONSTRAINT fk_user_invites_issued_by_user_id FOREIGN KEY (issued_by_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NULL,
    action_type VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(64) NULL,
    result VARCHAR(20) NOT NULL DEFAULT 'success',
    ip_address VARCHAR(64) NULL,
    user_agent VARCHAR(512) NULL,
    summary VARCHAR(255) NULL,
    meta_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_audit_logs_actor_user_id (actor_user_id),
    KEY idx_audit_logs_action_type (action_type),
    KEY idx_audit_logs_created_at (created_at),
    CONSTRAINT fk_audit_logs_actor_user_id FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;