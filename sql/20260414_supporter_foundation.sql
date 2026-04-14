CREATE TABLE supporter_subscriptions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'external',
    provider_customer_id VARCHAR(191) NULL,
    provider_subscription_id VARCHAR(191) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'inactive',
    plan_code VARCHAR(64) NOT NULL DEFAULT 'supporter_monthly_500',
    amount INT NOT NULL DEFAULT 500,
    currency VARCHAR(16) NOT NULL DEFAULT 'JPY',
    started_at DATETIME(6) NULL,
    current_period_start DATETIME(6) NULL,
    current_period_end DATETIME(6) NULL,
    canceled_at DATETIME(6) NULL,
    ended_at DATETIME(6) NULL,
    scheduled_start_at DATETIME(6) NULL,
    first_billing_at DATETIME(6) NULL,
    credited_months INT NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_supporter_subscription_provider (provider, provider_subscription_id),
    KEY idx_supporter_subscriptions_user (user_id),
    KEY idx_supporter_subscriptions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supporter_profile_settings (
    user_id BIGINT UNSIGNED NOT NULL,
    supporter_visible TINYINT(1) NOT NULL DEFAULT 1,
    supporter_badge_visible TINYINT(1) NOT NULL DEFAULT 1,
    supporter_duration_badge_visible TINYINT(1) NOT NULL DEFAULT 1,
    supporter_icon_frame_visible TINYINT(1) NOT NULL DEFAULT 1,
    supporter_profile_decor_visible TINYINT(1) NOT NULL DEFAULT 1,
    selected_icon_frame VARCHAR(64) NULL,
    selected_profile_decor VARCHAR(64) NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supporter_achievements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    achievement_code VARCHAR(32) NOT NULL,
    unlocked_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_supporter_achievement (user_id, achievement_code),
    KEY idx_supporter_achievements_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supporter_grants (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    grant_type VARCHAR(32) NOT NULL DEFAULT 'months',
    source_type VARCHAR(32) NOT NULL DEFAULT 'admin_gift',
    months INT NOT NULL DEFAULT 0,
    starts_at DATETIME(6) NULL,
    ends_at DATETIME(6) NULL,
    is_permanent TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    reason TEXT NULL,
    granted_by_user_id BIGINT UNSIGNED NULL,
    granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_by_user_id BIGINT UNSIGNED NULL,
    revoked_at DATETIME(6) NULL,
    revoke_reason TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_supporter_grants_user (user_id),
    KEY idx_supporter_grants_active (is_active, is_permanent, starts_at, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE supporter_provider_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    provider VARCHAR(32) NOT NULL DEFAULT 'external',
    event_type VARCHAR(64) NOT NULL,
    provider_event_id VARCHAR(191) NULL,
    provider_customer_id VARCHAR(191) NULL,
    provider_subscription_id VARCHAR(191) NULL,
    payload_json JSON NULL,
    received_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    processed_at DATETIME(6) NULL,
    process_status VARCHAR(32) NOT NULL DEFAULT 'received',
    error_summary TEXT NULL,
    related_user_id BIGINT UNSIGNED NULL,
    mismatch_flag TINYINT(1) NOT NULL DEFAULT 0,
    mismatch_type VARCHAR(64) NULL,
    resolved_at DATETIME(6) NULL,
    resolved_by_user_id BIGINT UNSIGNED NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_supporter_provider_event (provider, provider_event_id),
    KEY idx_supporter_provider_events_user (related_user_id),
    KEY idx_supporter_provider_events_mismatch (mismatch_flag, process_status),
    KEY idx_supporter_provider_events_subscription (provider_subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
