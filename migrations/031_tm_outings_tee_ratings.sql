-- 031_tm_outings_tee_ratings.sql
-- 2026-06-25
--
-- Stores BOTH genders' course/slope ratings for the tee an outing is played
-- from, so each player's Course Handicap can use THEIR gender's rating in a
-- mixed-gender match (the existing single course_rating/slope_rating captured
-- only the picker's gender, so a couple/mixed group got one rating for all).
--
-- Shape: { "male": {"cr": 71.5, "sr": 132}, "female": {"cr": 76.8, "sr": 140} }
-- (either key may be absent for a one-gender-only tee). Nullable — old outings
-- and unrated/free matches have NULL and fall back to the single rating
-- (today's behaviour). The existing course_rating/slope_rating columns stay.
--
-- Append-only. IF NOT EXISTS makes re-applying safe.

ALTER TABLE tm_outings ADD COLUMN IF NOT EXISTS tee_ratings JSONB;

COMMENT ON COLUMN tm_outings.tee_ratings IS
  'Both genders'' CR/SR for the played tee: {male:{cr,sr},female:{cr,sr}}. Lets each player''s Course Handicap use their gender''s rating in a mixed match. Nullable; falls back to course_rating/slope_rating. Added 2026-06-25.';
