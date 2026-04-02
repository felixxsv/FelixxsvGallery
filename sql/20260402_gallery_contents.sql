CREATE TABLE IF NOT EXISTS gallery_contents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gallery VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  alt TEXT NULL,
  shot_at DATETIME NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  is_public TINYINT(1) NOT NULL DEFAULT 1,
  uploader_user_id BIGINT UNSIGNED NULL,
  thumbnail_image_id BIGINT UNSIGNED NULL,
  image_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_gallery_contents_gallery_created_at (gallery, created_at),
  KEY idx_gallery_contents_gallery_shot_at (gallery, shot_at),
  KEY idx_gallery_contents_uploader_user_id (uploader_user_id),
  KEY idx_gallery_contents_thumbnail_image_id (thumbnail_image_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS gallery_content_images (
  content_id BIGINT UNSIGNED NOT NULL,
  image_id BIGINT UNSIGNED NOT NULL,
  sort_order INT UNSIGNED NULL,
  is_thumbnail TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (content_id, image_id),
  UNIQUE KEY uq_gallery_content_images_image_id (image_id),
  KEY idx_gallery_content_images_sort_order (content_id, sort_order),
  KEY idx_gallery_content_images_thumbnail (content_id, is_thumbnail),
  CONSTRAINT fk_gallery_content_images_content
    FOREIGN KEY (content_id) REFERENCES gallery_contents(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_gallery_content_images_image
    FOREIGN KEY (image_id) REFERENCES images(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
