ALTER TABLE gallery_contents
  ADD COLUMN upload_source VARCHAR(64) NULL DEFAULT 'web' AFTER uploader_user_id;
