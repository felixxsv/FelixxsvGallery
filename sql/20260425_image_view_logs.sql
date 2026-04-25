-- 画像閲覧ログ（重複カウント抑止用）
-- viewer_key は ログイン中: u:{user_id} / 未ログイン: g:{ip+UA hash 16文字}
-- last_viewed_at が一定時間（30分）より古い場合のみ更新し、その時のみ image_stats.view_count を加算する
-- 詳細は app/gallery_api.py の inc_view 参照

CREATE TABLE IF NOT EXISTS image_view_logs (
  image_id       BIGINT UNSIGNED NOT NULL,
  viewer_key     VARCHAR(64)     NOT NULL,
  last_viewed_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (image_id, viewer_key),
  KEY idx_image_view_logs_last_viewed (last_viewed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
