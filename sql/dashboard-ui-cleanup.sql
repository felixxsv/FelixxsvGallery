SET @dashboard_test_prefix := 'zz_test_dashboard_';

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
