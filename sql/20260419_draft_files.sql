CREATE TABLE IF NOT EXISTS draft_files (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  draft_id      BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  file_path     VARCHAR(1024)   NOT NULL,
  original_name VARCHAR(1024)   NOT NULL DEFAULT '',
  sort_order    INT             NOT NULL DEFAULT 0,
  created_at    DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_draft_files_draft_id (draft_id),
  CONSTRAINT fk_draft_files_draft_id FOREIGN KEY (draft_id) REFERENCES drafts (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
