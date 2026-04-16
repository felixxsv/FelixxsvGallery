-- focal_zoom カラム追加 (ズームレベル, デフォルト 1.0 = カバー基準)
ALTER TABLE images
ADD COLUMN IF NOT EXISTS focal_zoom FLOAT NOT NULL DEFAULT 1.0;
