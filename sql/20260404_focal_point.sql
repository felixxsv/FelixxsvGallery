-- focal_x, focal_y: カード表示時の画像フォーカルポイント (%)
-- 0〜100 の範囲、デフォルト 50（中央）
ALTER TABLE images
  ADD COLUMN focal_x FLOAT NOT NULL DEFAULT 50 AFTER is_public,
  ADD COLUMN focal_y FLOAT NOT NULL DEFAULT 50 AFTER focal_x;
