CREATE TABLE supporter_payment_history (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT 'external',
    provider_subscription_id VARCHAR(191) NULL,
    provider_payment_id VARCHAR(191) NULL,
    amount INT NOT NULL,
    currency VARCHAR(16) NOT NULL DEFAULT 'JPY',
    paid_at DATETIME(6) NOT NULL,
    period_start DATETIME(6) NULL,
    period_end DATETIME(6) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'paid',
    note TEXT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_supporter_payment_history_user (user_id, paid_at),
    KEY idx_supporter_payment_history_subscription (provider_subscription_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
