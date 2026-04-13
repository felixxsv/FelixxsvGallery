CREATE TABLE IF NOT EXISTS badges (
    badge_key VARCHAR(32) NOT NULL,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    acquisition VARCHAR(255) NULL,
    color VARCHAR(16) NOT NULL DEFAULT 'gray',
    badge_type ENUM('auto', 'manual') NOT NULL DEFAULT 'manual',
    icon VARCHAR(255) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    auto_grant_kind ENUM('none', 'role', 'account_age_years', 'post_count') NOT NULL DEFAULT 'none',
    auto_grant_value INT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (badge_key),
    KEY idx_badges_sort (sort_order, badge_key),
    KEY idx_badges_auto (auto_grant_kind, auto_grant_value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO badges (
    badge_key, name, description, acquisition, color, badge_type, icon, sort_order,
    auto_grant_kind, auto_grant_value, is_active
) VALUES
    ('role_admin', '管理者', 'ギャラリー管理者', '管理者権限を持つ', 'red', 'auto', 'role_admin.png', 1, 'role', NULL, 1),
    ('year_1', '1年生', 'アカウント作成から1年以上', 'アカウント作成から1年以上経過する', 'blue', 'auto', 'year_1.png', 10, 'account_age_years', 1, 1),
    ('year_2', '2年生', 'アカウント作成から2年以上', 'アカウント作成から2年以上経過する', 'blue', 'auto', 'year_2.png', 11, 'account_age_years', 2, 1),
    ('year_3', '3年生', 'アカウント作成から3年以上', 'アカウント作成から3年以上経過する', 'blue', 'auto', 'year_3.png', 12, 'account_age_years', 3, 1),
    ('year_4', '4年生', 'アカウント作成から4年以上', 'アカウント作成から4年以上経過する', 'blue', 'auto', 'year_4.png', 13, 'account_age_years', 4, 1),
    ('year_5', '5年生', 'アカウント作成から5年以上', 'アカウント作成から5年以上経過する', 'blue', 'auto', 'year_5.png', 14, 'account_age_years', 5, 1),
    ('post_first', 'はじめの一歩', '初めての投稿', '1件以上投稿する', 'green', 'auto', 'post_first.png', 20, 'post_count', 1, 1),
    ('post_50', '50投稿', '投稿数50件以上', '50件以上投稿する', 'green', 'auto', 'post_50.png', 21, 'post_count', 50, 1),
    ('post_100', '100投稿', '投稿数100件以上', '100件以上投稿する', 'green', 'auto', 'post_100.png', 22, 'post_count', 100, 1),
    ('post_500', '500投稿', '投稿数500件以上', '500件以上投稿する', 'green', 'auto', 'post_500.png', 23, 'post_count', 500, 1),
    ('post_1000', '1000投稿', '投稿数1000件以上', '1000件以上投稿する', 'green', 'auto', 'post_1000.png', 24, 'post_count', 1000, 1),
    ('pioneer', '先駆者', '初期メンバーとして特別に認定されたユーザー', '管理者から付与される', 'gold', 'manual', 'pioneer.png', 30, 'none', NULL, 1),
    ('photographer', '写真家', '質の高い写真を投稿すると認定されたユーザー', '管理者から付与される', 'gold', 'manual', 'photographer.png', 31, 'none', NULL, 1),
    ('regular', '常連', '長期にわたって活発に活動しているユーザー', '管理者から付与される', 'gold', 'manual', 'regular.png', 32, 'none', NULL, 1),
    ('notable', '注目の人', 'コミュニティで特に注目されているユーザー', '管理者から付与される', 'gold', 'manual', 'notable.png', 33, 'none', NULL, 1),
    ('supporter', 'サポーター', 'ギャラリーを支援したユーザー', '管理者から付与される', 'gold', 'manual', 'supporter.png', 34, 'none', NULL, 1),
    ('tester', 'テスター', '機能改善に協力したユーザー', '管理者から付与される', 'blue', 'manual', 'tester.png', 35, 'none', NULL, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    description = VALUES(description),
    acquisition = VALUES(acquisition),
    color = VALUES(color),
    badge_type = VALUES(badge_type),
    icon = VALUES(icon),
    sort_order = VALUES(sort_order),
    auto_grant_kind = VALUES(auto_grant_kind),
    auto_grant_value = VALUES(auto_grant_value),
    is_active = VALUES(is_active);
