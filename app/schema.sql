CREATE DATABASE IF NOT EXISTS felixxsv_gallery
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE felixxsv_gallery;

CREATE TABLE IF NOT EXISTS images (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gallery VARCHAR(64) NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  shot_at DATETIME(6) NOT NULL,
  shot_date DATE GENERATED ALWAYS AS (DATE(shot_at)) STORED,
  title VARCHAR(255) NULL,
  alt TEXT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  format VARCHAR(16) NOT NULL,
  thumb_path_480 VARCHAR(1024) NULL,
  thumb_path_960 VARCHAR(1024) NULL,
  preview_path VARCHAR(1024) NULL,
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  like_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_images_gallery_hash (gallery, content_hash),
  KEY idx_images_gallery_shot_at (gallery, shot_at),
  KEY idx_images_gallery_shot_date (gallery, shot_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS image_sources (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  image_id BIGINT UNSIGNED NOT NULL,
  gallery VARCHAR(64) NOT NULL,
  source_path VARCHAR(2048) NOT NULL,
  source_path_hash BINARY(32) GENERATED ALWAYS AS (UNHEX(SHA2(source_path, 256))) STORED,
  size_bytes BIGINT UNSIGNED NOT NULL,
  mtime_epoch BIGINT UNSIGNED NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  status TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sources_gallery_pathhash (gallery, source_path_hash),
  KEY idx_sources_image (image_id),
  KEY idx_sources_gallery_hash (gallery, content_hash),
  KEY idx_sources_primary (gallery, is_primary),
  KEY idx_sources_gallery_path_prefix (gallery, source_path(255)),
  CONSTRAINT fk_sources_image
    FOREIGN KEY (image_id) REFERENCES images(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS image_colors (
  image_id BIGINT UNSIGNED NOT NULL,
  rank_no TINYINT UNSIGNED NOT NULL,
  color_id TINYINT UNSIGNED NOT NULL,
  ratio DECIMAL(6,5) NOT NULL,
  PRIMARY KEY (image_id, rank_no),
  KEY idx_colors_color (color_id, image_id),
  CONSTRAINT fk_colors_image
    FOREIGN KEY (image_id) REFERENCES images(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gallery VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tags_gallery_name (gallery, name),
  KEY idx_tags_gallery (gallery)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS image_tags (
  image_id BIGINT UNSIGNED NOT NULL,
  tag_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (image_id, tag_id),
  KEY idx_image_tags_tag (tag_id, image_id),
  CONSTRAINT fk_image_tags_image
    FOREIGN KEY (image_id) REFERENCES images(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_image_tags_tag
    FOREIGN KEY (tag_id) REFERENCES tags(id)
    ON DELETE CASCADE
) ENGINE=InnoDB;
