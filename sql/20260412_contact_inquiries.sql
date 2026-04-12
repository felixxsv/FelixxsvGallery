-- Create contact_inquiries table for user-submitted inquiries to admin
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  category    VARCHAR(32)     NOT NULL,
  message     TEXT            NOT NULL,
  status      VARCHAR(16)     NOT NULL DEFAULT 'open',
  created_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  KEY idx_contact_inquiries_status_created (status, created_at),
  KEY idx_contact_inquiries_created (created_at),
  KEY idx_contact_inquiries_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
