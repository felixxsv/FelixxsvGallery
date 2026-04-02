CREATE TABLE IF NOT EXISTS image_likes (
    image_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (image_id, user_id),
    KEY idx_image_likes_user_created_at (user_id, created_at),
    KEY idx_image_likes_user_image (user_id, image_id),
    CONSTRAINT fk_image_likes_image FOREIGN KEY (image_id) REFERENCES images (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_image_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
