-- Remove orphaned 'star' badge data (badge was removed from catalog, PNG does not exist)
-- Safe to run even if no rows match.

-- 1. Remove star badge rows from user badge pools
DELETE FROM user_badges WHERE badge_key = 'star';

-- 2. Remove 'star' from display_badges JSON arrays in users table
--    JSON_SEARCH returns the path (e.g. '$[1]') of the first 'star' occurrence;
--    JSON_REMOVE removes that element. Run once per row that contains 'star'.
UPDATE users
SET display_badges = JSON_REMOVE(
    display_badges,
    JSON_UNQUOTE(JSON_SEARCH(display_badges, 'one', 'star'))
)
WHERE JSON_SEARCH(display_badges, 'one', 'star') IS NOT NULL;
