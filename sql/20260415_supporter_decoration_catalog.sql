CREATE TABLE supporter_decoration_catalog (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    decoration_kind VARCHAR(32) NOT NULL,
    decoration_key VARCHAR(64) NOT NULL,
    label_key VARCHAR(191) NOT NULL,
    preview_class VARCHAR(191) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    UNIQUE KEY uq_supporter_decoration_catalog (decoration_kind, decoration_key),
    KEY idx_supporter_decoration_catalog_kind (decoration_kind, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO supporter_decoration_catalog (
    decoration_kind,
    decoration_key,
    label_key,
    preview_class,
    sort_order,
    is_active
) VALUES
    ('icon_frame', 'aurora_ring', 'support.icon_frame.aurora_ring', 'supporter-icon-frame--aurora-ring', 10, 1),
    ('icon_frame', 'amber_ring', 'support.icon_frame.amber_ring', 'supporter-icon-frame--amber-ring', 20, 1),
    ('profile_decor', 'aurora_glow', 'support.profile_decor.aurora_glow', 'supporter-profile-decor--aurora-glow', 10, 1),
    ('profile_decor', 'sunrise_wave', 'support.profile_decor.sunrise_wave', 'supporter-profile-decor--sunrise-wave', 20, 1)
ON DUPLICATE KEY UPDATE
    label_key = VALUES(label_key),
    preview_class = VALUES(preview_class),
    sort_order = VALUES(sort_order),
    is_active = VALUES(is_active),
    updated_at = CURRENT_TIMESTAMP(6);
