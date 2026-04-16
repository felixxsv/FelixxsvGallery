CREATE TABLE IF NOT EXISTS drafts (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  title          VARCHAR(255)    NOT NULL DEFAULT '',
  alt            TEXT            NULL,
  tags           VARCHAR(1024)   NULL,
  is_public      TINYINT(1)      NOT NULL DEFAULT 1,
  shot_at        DATETIME        NULL,
  focal_x        FLOAT           NOT NULL DEFAULT 50.0,
  focal_y        FLOAT           NOT NULL DEFAULT 50.0,
  focal_zoom     FLOAT           NOT NULL DEFAULT 1.0,
  thumbnail_path VARCHAR(1024)   NULL,
  created_at     DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_drafts_user_id_created_at (user_id, created_at),
  CONSTRAINT fk_drafts_user_id FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
