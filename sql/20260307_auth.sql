CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gallery VARCHAR(64) NOT NULL,
  user_key VARCHAR(20) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  can_upload TINYINT(1) NOT NULL DEFAULT 1,
  is_disabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_gallery_user_key (gallery, user_key),
  UNIQUE KEY uq_users_gallery_email (gallery, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_sessions (
  sid CHAR(64) NOT NULL,
  gallery VARCHAR(64) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  last_seen_at DATETIME(6) NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  user_agent VARCHAR(512) NOT NULL DEFAULT '',
  ip_addr VARCHAR(64) NOT NULL DEFAULT '',
  PRIMARY KEY (sid),
  KEY idx_sessions_gallery_user (gallery, user_id),
  KEY idx_sessions_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @db := DATABASE();
SET @tbl := 'images';
SET @col := 'uploader_user_id';
SELECT COUNT(*) INTO @exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=@db AND TABLE_NAME=@tbl AND COLUMN_NAME=@col;
SET @sql := IF(@exists=0, 'ALTER TABLE images ADD COLUMN uploader_user_id BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;