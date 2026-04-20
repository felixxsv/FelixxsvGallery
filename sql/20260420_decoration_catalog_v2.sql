-- Decoration catalog v2:
--   - Add asset_path (SVG file path under storage/)
--   - Add labels  (JSON multi-language names: {"ja":"...","en":"...",...})
--   - Remove CSS-only placeholder entries (aurora_ring, amber_ring, aurora_glow, sunrise_wave)

ALTER TABLE supporter_decoration_catalog
  ADD COLUMN asset_path VARCHAR(512) NULL COMMENT 'Relative path under storage/, e.g. decorations/my_frame.svg'
    AFTER preview_class,
  ADD COLUMN labels JSON NULL COMMENT 'Multi-language names: {"ja":"...","en":"...",...}'
    AFTER asset_path;

-- Remove hardcoded CSS-only entries; real designs will be added via admin UI
DELETE FROM supporter_decoration_catalog
WHERE decoration_key IN ('aurora_ring', 'amber_ring', 'aurora_glow', 'sunrise_wave');
