SET @dashboard_test_prefix := 'zz_test_dashboard_';
SET @dashboard_test_now := UTC_TIMESTAMP(6);
SET @gallery := COALESCE(
  (SELECT gallery FROM users ORDER BY id LIMIT 1),
  (SELECT gallery FROM images ORDER BY id LIMIT 1),
  'vrchat'
);

DELETE s
FROM user_sessions s
JOIN users u ON u.id = s.user_id
WHERE u.user_key LIKE CONCAT(@dashboard_test_prefix, '%');

DELETE FROM users
WHERE user_key LIKE CONCAT(@dashboard_test_prefix, '%');

DELETE ii
FROM integrity_issues ii
JOIN integrity_runs ir ON ir.id = ii.run_id
WHERE ir.message LIKE '[dashboard-ui-test]%';

DELETE FROM integrity_runs
WHERE message LIKE '[dashboard-ui-test]%';

INSERT INTO users (
  gallery,
  user_key,
  display_name,
  email,
  password_hash,
  role,
  status,
  can_upload,
  is_disabled,
  is_email_verified,
  must_reset_password
) VALUES
(@gallery, 'zz_test_dashboard_01', 'UIテスト01', 'zz_test_dashboard_01@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_02', 'UIテスト02', 'zz_test_dashboard_02@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_03', 'UIテスト03', 'zz_test_dashboard_03@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_04', 'UIテスト04', 'zz_test_dashboard_04@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_05', 'UIテスト05', 'zz_test_dashboard_05@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_06', 'UIテスト06', 'zz_test_dashboard_06@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_07', 'UIテスト07', 'zz_test_dashboard_07@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_08', 'UIテスト08', 'zz_test_dashboard_08@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_09', 'UIテスト09', 'zz_test_dashboard_09@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_10', 'UIテスト10', 'zz_test_dashboard_10@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_11', 'UIテスト11', 'zz_test_dashboard_11@example.invalid', '!', 'user', 'active', 1, 0, 1, 0),
(@gallery, 'zz_test_dashboard_12', 'UIテスト12', 'zz_test_dashboard_12@example.invalid', '!', 'user', 'active', 1, 0, 1, 0);

INSERT INTO user_sessions (
  sid,
  gallery,
  user_id,
  created_at,
  last_seen_at,
  expires_at,
  two_factor_verified_at,
  two_factor_remember_until,
  user_agent,
  ip_addr
)
SELECT
  SHA2(CONCAT('dashboard-ui-test-session-', u.user_key, '-', UUID()), 256),
  @gallery,
  u.id,
  @dashboard_test_now - INTERVAL 25 MINUTE,
  @dashboard_test_now - INTERVAL 15 SECOND,
  @dashboard_test_now + INTERVAL 1 DAY,
  @dashboard_test_now - INTERVAL 24 MINUTE,
  @dashboard_test_now + INTERVAL 30 DAY,
  CONCAT('dashboard-ui-test/', u.user_key),
  '127.0.0.1'
FROM users u
WHERE u.user_key LIKE CONCAT(@dashboard_test_prefix, '%')
ORDER BY u.user_key;

INSERT INTO integrity_runs (
  run_uuid,
  trigger_source,
  status,
  requested_by_user_id,
  requested_at,
  scheduled_for,
  started_at,
  finished_at,
  exit_code,
  summary_json,
  report_path,
  message
) VALUES (
  UUID(),
  'manual',
  'warning',
  NULL,
  @dashboard_test_now - INTERVAL 20 MINUTE,
  NULL,
  @dashboard_test_now - INTERVAL 19 MINUTE,
  @dashboard_test_now - INTERVAL 18 MINUTE,
  0,
  JSON_OBJECT(
    'severity_counts', JSON_OBJECT('warning', 7, 'error', 5),
    'issue_counts', JSON_OBJECT('missing_preview', 4, 'orphan_file', 3, 'db_mismatch', 3, 'missing_thumb', 2)
  ),
  NULL,
  '[dashboard-ui-test] latest warning run'
);

SET @integrity_test_run_id := LAST_INSERT_ID();

INSERT INTO integrity_issues (
  run_id,
  severity,
  issue_code,
  gallery,
  image_id,
  source_id,
  file_path,
  derivative_kind,
  detail_json,
  created_at
) VALUES
(@integrity_test_run_id, 'error',   'missing_preview', @gallery, NULL, NULL, '/dashboard-test/content/001/main.webp', 'preview', JSON_OBJECT('summary', 'preview が見つかりません。', 'content_id', 1), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'error',   'missing_thumb',   @gallery, NULL, NULL, '/dashboard-test/content/001/thumb_480.webp', 'thumb_480', JSON_OBJECT('summary', '480px サムネイルが見つかりません。', 'content_id', 1), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'error',   'db_mismatch',     @gallery, NULL, NULL, '/dashboard-test/content/002/main.webp', 'original', JSON_OBJECT('summary', 'DB の件数とファイル実体が一致しません。', 'content_id', 2), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'error',   'orphan_file',     @gallery, NULL, NULL, '/dashboard-test/content/003/orphan.webp', 'original', JSON_OBJECT('summary', 'DB 未登録の孤立ファイルです。', 'content_id', 3), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'error',   'missing_preview', @gallery, NULL, NULL, '/dashboard-test/content/004/main.webp', 'preview', JSON_OBJECT('summary', 'preview が見つかりません。', 'content_id', 4), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'missing_thumb',   @gallery, NULL, NULL, '/dashboard-test/content/005/thumb_960.webp', 'thumb_960', JSON_OBJECT('summary', '960px サムネイルが見つかりません。', 'content_id', 5), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'orphan_file',     @gallery, NULL, NULL, '/dashboard-test/content/006/orphan.webp', 'original', JSON_OBJECT('summary', '孤立ファイル候補です。', 'content_id', 6), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'db_mismatch',     @gallery, NULL, NULL, '/dashboard-test/content/007/main.webp', 'original', JSON_OBJECT('summary', '参照先メタ情報の不一致があります。', 'content_id', 7), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'missing_preview', @gallery, NULL, NULL, '/dashboard-test/content/008/main.webp', 'preview', JSON_OBJECT('summary', 'preview が見つかりません。', 'content_id', 8), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'missing_thumb',   @gallery, NULL, NULL, '/dashboard-test/content/009/thumb_480.webp', 'thumb_480', JSON_OBJECT('summary', '480px サムネイルが見つかりません。', 'content_id', 9), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'orphan_file',     @gallery, NULL, NULL, '/dashboard-test/content/010/orphan.webp', 'original', JSON_OBJECT('summary', '孤立ファイル候補です。', 'content_id', 10), @dashboard_test_now - INTERVAL 18 MINUTE),
(@integrity_test_run_id, 'warning', 'db_mismatch',     @gallery, NULL, NULL, '/dashboard-test/content/011/main.webp', 'original', JSON_OBJECT('summary', 'DB と実体の差分があります。', 'content_id', 11), @dashboard_test_now - INTERVAL 18 MINUTE);

INSERT INTO integrity_runs (
  run_uuid,
  trigger_source,
  status,
  requested_by_user_id,
  requested_at,
  scheduled_for,
  started_at,
  finished_at,
  exit_code,
  summary_json,
  report_path,
  message
) VALUES (
  UUID(),
  'manual',
  'queued',
  NULL,
  @dashboard_test_now - INTERVAL 30 MINUTE,
  @dashboard_test_now + INTERVAL 10 MINUTE,
  NULL,
  NULL,
  NULL,
  JSON_OBJECT(),
  NULL,
  '[dashboard-ui-test] queued run'
);
