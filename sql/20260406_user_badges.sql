-- User badge pool: badges earned/granted per user
CREATE TABLE user_badges (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    badge_key VARCHAR(32) NOT NULL,
    granted_by BIGINT UNSIGNED NULL COMMENT 'NULL = auto-granted',
    granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_badge (user_id, badge_key),
    KEY idx_user_badges_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Display badge selection: up to 3 badge_keys shown on public profile
ALTER TABLE users
    ADD COLUMN display_badges JSON NULL AFTER bio;
