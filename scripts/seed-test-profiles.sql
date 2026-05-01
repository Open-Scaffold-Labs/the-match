-- ═══════════════════════════════════════════════════════════════
-- seed-test-profiles.sql  —  Populate fake test users with data
-- ═══════════════════════════════════════════════════════════════
--
-- Gives the five test profiles (Dale, Chris, Ryan, Sam, Taylor) enough
-- data that tapping them from Matt's friends list shows a realistic
-- friend-profile screen: rounds, season W-L-T-AVG3, recent rounds,
-- H2H record vs Matt, and upcoming availability.
--
-- IDEMPOTENT — safely re-runnable:
--   • Profile fields are written via UPDATE (no rows added)
--   • Seasons use ON CONFLICT DO NOTHING
--   • Availability uses ON CONFLICT DO NOTHING (UNIQUE on user_id+date)
--   • Test rounds + outings are removed and re-inserted (filtered to
--     only the test rows by a name pattern in tm_outings and a
--     created-by-seed marker date) so re-running gives a clean slate
--
-- NOT a migration — kept in scripts/ because it touches user-visible
-- data, not schema. Run from Matt's Mac:
--   psql $DATABASE_URL -f scripts/seed-test-profiles.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── Profile fields (upsert via UPDATE) ───────────────────────────
UPDATE tm_users SET handicap = 8.0,  home_course = 'Pebble Beach Golf Links', bio = 'Single-digit cap. Plays whatever''s in front of me.'  WHERE id = 4;  -- Dale
UPDATE tm_users SET handicap = 14.0, home_course = 'TPC Sawgrass',            bio = 'Mid-cap. Pretends to be a 10.'                          WHERE id = 5;  -- Chris
UPDATE tm_users SET handicap = 2.0,  home_course = 'Augusta National',        bio = 'Low-cap. Hits the ball where the air''s thin.'           WHERE id = 6;  -- Ryan
UPDATE tm_users SET handicap = 5.2,  home_course = 'Torrey Pines',            bio = 'West-coast game. Loves a poa-annua green.'               WHERE id = 9;  -- Sam
UPDATE tm_users SET handicap = 12.6, home_course = 'Bethpage Black',          bio = 'Long off the tee, lost a wedge somewhere in 2018.'       WHERE id = 10; -- Taylor

-- ── Seasons: 2025 (started) + 2026 (started) ────────────────────
INSERT INTO tm_user_seasons (user_id, season_year, started_at)
VALUES
  (4, 2025, '2025-05-15 12:00:00+00'), (4, 2026, '2026-04-12 12:00:00+00'),
  (5, 2025, '2025-05-20 12:00:00+00'), (5, 2026, '2026-04-15 12:00:00+00'),
  (6, 2025, '2025-04-30 12:00:00+00'), (6, 2026, '2026-04-08 12:00:00+00'),
  (9, 2025, '2025-05-12 12:00:00+00'), (9, 2026, '2026-04-22 12:00:00+00'),
  (10, 2025, '2025-05-25 12:00:00+00'), (10, 2026, '2026-04-18 12:00:00+00')
ON CONFLICT (user_id, season_year) DO NOTHING;

-- ── Availability: spread some open days over the next 2 weeks ─────
-- Use NOW() as anchor so the seed stays "fresh" whenever it's run.
INSERT INTO tm_availability (user_id, date, note) VALUES
  (4,  (CURRENT_DATE + INTERVAL '2 days'),  'Morning'),
  (4,  (CURRENT_DATE + INTERVAL '5 days'),  'All day'),
  (4,  (CURRENT_DATE + INTERVAL '9 days'),  'Afternoon'),
  (5,  (CURRENT_DATE + INTERVAL '1 day'),   'After 1pm'),
  (5,  (CURRENT_DATE + INTERVAL '4 days'),  NULL),
  (5,  (CURRENT_DATE + INTERVAL '11 days'), 'Twilight'),
  (6,  (CURRENT_DATE + INTERVAL '3 days'),  NULL),
  (6,  (CURRENT_DATE + INTERVAL '7 days'),  'Open all day'),
  (6,  (CURRENT_DATE + INTERVAL '12 days'), NULL),
  (9,  (CURRENT_DATE + INTERVAL '2 days'),  NULL),
  (9,  (CURRENT_DATE + INTERVAL '6 days'),  'Morning loop'),
  (9,  (CURRENT_DATE + INTERVAL '10 days'), NULL),
  (10, (CURRENT_DATE + INTERVAL '1 day'),   NULL),
  (10, (CURRENT_DATE + INTERVAL '8 days'),  'Looking for a fourth'),
  (10, (CURRENT_DATE + INTERVAL '13 days'), NULL)
ON CONFLICT (user_id, date) DO NOTHING;

-- ── Wipe prior seed-generated rounds for these users only ────────
-- We mark seed rounds by NULL outing_id AND course_name in the test
-- set. Keeps any real rounds the user logged via the app intact.
DELETE FROM tm_rounds
WHERE user_id IN (4, 5, 6, 9, 10)
  AND outing_id IS NULL
  AND course_name IN (
    'Pebble Beach Golf Links', 'TPC Sawgrass', 'Augusta National',
    'Torrey Pines', 'Bethpage Black', 'Pinehurst No. 2',
    'Whistling Straits', 'Bandon Dunes', 'Erin Hills', 'Streamsong Red'
  );

-- ── Solo rounds per test user ────────────────────────────────────
-- Score arrays are 18 holes. Totals chosen to match each user's skill.
-- All entries > 0 so the round counts as completed for the handicap calc.
-- Date is offset back from today so rounds populate the trend chart in
-- chronological order (oldest first → most recent).
INSERT INTO tm_rounds (user_id, course_name, course_par, course_rating, slope_rating, game_type, scores, total, date) VALUES
  -- Dale (8 hcp, par-72 typical) — totals around 79-83
  (4, 'Pebble Beach Golf Links', 72, 71.7, 138, 'stroke', '[5,4,3,5,5,4,4,4,5, 4,4,6,4,4,4,3,5,4]'::jsonb, 83, CURRENT_DATE - INTERVAL '42 days'),
  (4, 'Pebble Beach Golf Links', 72, 71.7, 138, 'stroke', '[4,5,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,4,5]'::jsonb, 79, CURRENT_DATE - INTERVAL '32 days'),
  (4, 'Pinehurst No. 2',         72, 75.7, 137, 'stroke', '[5,5,3,5,5,4,4,4,5, 5,4,5,4,4,4,3,5,4]'::jsonb, 84, CURRENT_DATE - INTERVAL '21 days'),
  (4, 'Pebble Beach Golf Links', 72, 71.7, 138, 'stroke', '[4,4,3,4,5,4,4,4,5, 4,4,5,4,4,5,3,4,4]'::jsonb, 78, CURRENT_DATE - INTERVAL '12 days'),
  (4, 'Whistling Straits',       72, 76.7, 151, 'stroke', '[5,4,3,4,5,4,5,4,5, 4,5,5,4,4,4,3,5,4]'::jsonb, 82, CURRENT_DATE - INTERVAL '5 days'),

  -- Chris (14 hcp) — totals around 85-91
  (5, 'TPC Sawgrass',     72, 76.8, 145, 'stroke', '[5,5,4,5,6,4,5,4,6, 5,4,6,4,5,5,4,5,4]'::jsonb, 90, CURRENT_DATE - INTERVAL '38 days'),
  (5, 'TPC Sawgrass',     72, 76.8, 145, 'stroke', '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,3,4,4]'::jsonb, 87, CURRENT_DATE - INTERVAL '28 days'),
  (5, 'Bethpage Black',   72, 77.5, 152, 'stroke', '[6,5,4,5,6,5,5,4,6, 5,5,7,4,5,5,4,5,4]'::jsonb, 94, CURRENT_DATE - INTERVAL '18 days'),
  (5, 'Erin Hills',       72, 76.0, 139, 'stroke', '[5,5,3,5,6,4,5,4,6, 5,4,6,4,5,5,3,5,4]'::jsonb, 88, CURRENT_DATE - INTERVAL '8 days'),
  (5, 'TPC Sawgrass',     72, 76.8, 145, 'stroke', '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,3,5,4]'::jsonb, 88, CURRENT_DATE - INTERVAL '2 days'),

  -- Ryan (2 hcp) — totals around 71-76
  (6, 'Augusta National',  72, 76.2, 137, 'stroke', '[4,4,3,4,5,4,4,3,4, 4,4,5,3,4,4,3,4,4]'::jsonb, 70, CURRENT_DATE - INTERVAL '40 days'),
  (6, 'Augusta National',  72, 76.2, 137, 'stroke', '[4,4,3,4,5,4,4,3,5, 4,4,5,4,4,4,3,4,4]'::jsonb, 72, CURRENT_DATE - INTERVAL '30 days'),
  (6, 'Streamsong Red',    72, 75.0, 138, 'stroke', '[4,4,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,4,5]'::jsonb, 74, CURRENT_DATE - INTERVAL '20 days'),
  (6, 'Pinehurst No. 2',   72, 75.7, 137, 'stroke', '[5,4,3,4,5,4,4,3,5, 4,4,5,4,4,4,3,4,4]'::jsonb, 73, CURRENT_DATE - INTERVAL '10 days'),
  (6, 'Augusta National',  72, 76.2, 137, 'stroke', '[4,4,3,4,5,4,4,3,4, 4,4,5,4,4,4,3,4,4]'::jsonb, 71, CURRENT_DATE - INTERVAL '3 days'),

  -- Sam (5.2 hcp) — totals around 76-80
  (9, 'Torrey Pines',     72, 75.6, 142, 'stroke', '[4,5,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,4,4]'::jsonb, 78, CURRENT_DATE - INTERVAL '36 days'),
  (9, 'Torrey Pines',     72, 75.6, 142, 'stroke', '[5,4,3,4,5,4,4,4,5, 4,4,5,4,4,5,3,4,5]'::jsonb, 80, CURRENT_DATE - INTERVAL '25 days'),
  (9, 'Bandon Dunes',     72, 74.5, 132, 'stroke', '[4,4,3,5,5,4,4,4,5, 4,4,5,4,4,4,3,4,5]'::jsonb, 78, CURRENT_DATE - INTERVAL '14 days'),
  (9, 'Torrey Pines',     72, 75.6, 142, 'stroke', '[4,5,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,5,4]'::jsonb, 79, CURRENT_DATE - INTERVAL '7 days'),
  (9, 'Whistling Straits', 72, 76.7, 151, 'stroke', '[5,5,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,4,5]'::jsonb, 80, CURRENT_DATE - INTERVAL '1 day'),

  -- Taylor (12.6 hcp) — totals around 84-88
  (10, 'Bethpage Black', 72, 77.5, 152, 'stroke', '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,3,5,4]'::jsonb, 88, CURRENT_DATE - INTERVAL '34 days'),
  (10, 'Bethpage Black', 72, 77.5, 152, 'stroke', '[5,5,4,5,6,4,5,4,6, 5,4,6,4,5,5,3,4,4]'::jsonb, 89, CURRENT_DATE - INTERVAL '26 days'),
  (10, 'Erin Hills',     72, 76.0, 139, 'stroke', '[5,5,4,5,5,4,5,4,5, 5,4,6,4,5,5,3,4,4]'::jsonb, 86, CURRENT_DATE - INTERVAL '15 days'),
  (10, 'Bethpage Black', 72, 77.5, 152, 'stroke', '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,4,5,4]'::jsonb, 89, CURRENT_DATE - INTERVAL '6 days'),
  (10, 'Bethpage Black', 72, 77.5, 152, 'stroke', '[5,5,4,5,5,4,5,4,5, 5,4,6,4,5,5,3,4,5]'::jsonb, 87, CURRENT_DATE - INTERVAL '1 day');

-- ── Outings between Matt + each test user → drives H2H records ──
-- The tm_h2h tracker auto-updates via the trigger on tm_match_history.
-- We create one tm_outings row per matchup, two participants each, then
-- a tm_match_history row.
-- Idempotency: identify seed outings by a name pattern and delete first.

DELETE FROM tm_match_history WHERE outing_id IN (SELECT id FROM tm_outings WHERE name LIKE 'Seed:%');
DELETE FROM tm_outing_participants WHERE outing_id IN (SELECT id FROM tm_outings WHERE name LIKE 'Seed:%');
DELETE FROM tm_rounds WHERE outing_id IN (SELECT id FROM tm_outings WHERE name LIKE 'Seed:%');
DELETE FROM tm_outings WHERE name LIKE 'Seed:%';
-- And clear the H2H rows that the seed wrote previously (recompute from scratch each run)
-- Pairs of (Matt=1, test_user). LEAST/GREATEST handles the canonical ordering.
DELETE FROM tm_h2h_records WHERE
  (player_a_id = LEAST(1, 4)  AND player_b_id = GREATEST(1, 4))  OR
  (player_a_id = LEAST(1, 5)  AND player_b_id = GREATEST(1, 5))  OR
  (player_a_id = LEAST(1, 6)  AND player_b_id = GREATEST(1, 6))  OR
  (player_a_id = LEAST(1, 9)  AND player_b_id = GREATEST(1, 9))  OR
  (player_a_id = LEAST(1, 10) AND player_b_id = GREATEST(1, 10));

-- Helper-ish pattern: for each (test_user, n_matches, my_score, their_score, course, days_ago) row,
-- create the outing + 2 participants + match_history. Doing it inline below for clarity.

-- Matt (id=1) seed score arrays — use a mid-cap 17-handicap-ish profile (~88-92)
-- Stored once and referenced via temp table to avoid duplication.
CREATE TEMP TABLE _seed_match (
  id           SERIAL PRIMARY KEY,
  test_user_id BIGINT  NOT NULL,
  course_name  TEXT    NOT NULL,
  course_par   INT     NOT NULL,
  course_rating NUMERIC(4,1),
  slope_rating  INT,
  matt_total   INT     NOT NULL,
  test_total   INT     NOT NULL,
  matt_scores  JSONB   NOT NULL,
  test_scores  JSONB   NOT NULL,
  played_at    TIMESTAMPTZ NOT NULL
);

INSERT INTO _seed_match
  (test_user_id, course_name, course_par, course_rating, slope_rating, matt_total, test_total, matt_scores, test_scores, played_at) VALUES
  -- Matt vs Dale (Matt 17, Dale 8) — Dale wins all 3
  (4, 'Pebble Beach Golf Links', 72, 71.7, 138, 92, 81, '[6,5,4,5,6,5,5,4,6, 6,5,7,5,5,5,4,5,5]'::jsonb, '[5,4,3,4,5,4,4,4,5, 4,5,5,4,4,5,3,5,4]'::jsonb, NOW() - INTERVAL '37 days'),
  (4, 'Bayonne Golf Club',       72, 75.2, 142, 90, 80, '[5,5,4,5,6,5,5,4,6, 5,5,7,5,5,5,3,5,5]'::jsonb, '[5,4,3,4,5,4,4,4,5, 4,4,5,4,4,5,3,4,5]'::jsonb, NOW() - INTERVAL '23 days'),
  (4, 'Pebble Beach Golf Links', 72, 71.7, 138, 89, 82, '[5,5,4,5,6,5,5,4,5, 5,5,7,5,5,5,3,5,5]'::jsonb, '[5,4,3,5,5,4,4,4,5, 4,4,5,4,4,5,3,5,5]'::jsonb, NOW() - INTERVAL '11 days'),

  -- Matt vs Chris (Matt 17, Chris 14) — split: Matt 1, Chris 1, tie 1
  (5, 'Bayonne Golf Club',  72, 75.2, 142, 90, 87, '[5,5,4,5,6,5,5,4,5, 5,5,7,5,5,5,3,5,5]'::jsonb, '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,3,4,5]'::jsonb, NOW() - INTERVAL '34 days'),
  (5, 'TPC Sawgrass',       72, 76.8, 145, 88, 89, '[5,5,4,5,5,5,5,4,5, 5,4,6,5,5,5,3,5,5]'::jsonb, '[5,5,4,5,6,5,5,4,6, 5,4,6,4,5,5,3,5,4]'::jsonb, NOW() - INTERVAL '20 days'),
  (5, 'Bayonne Golf Club',  72, 75.2, 142, 88, 88, '[5,5,4,5,5,5,5,4,5, 5,4,6,5,5,5,3,5,5]'::jsonb, '[5,5,4,5,5,4,5,4,5, 5,4,7,4,5,5,3,4,5]'::jsonb, NOW() - INTERVAL '9 days'),

  -- Matt vs Ryan (Matt 17, Ryan 2) — Ryan wins all 2
  (6, 'Bayonne Golf Club', 72, 75.2, 142, 91, 73, '[5,5,4,5,6,5,5,4,6, 5,5,7,5,5,5,3,5,5]'::jsonb, '[4,4,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,4,4]'::jsonb, NOW() - INTERVAL '29 days'),
  (6, 'Augusta National',  72, 76.2, 137, 93, 71, '[5,5,4,6,6,5,5,5,6, 5,5,7,5,5,5,4,5,4]'::jsonb, '[4,4,3,4,5,4,4,3,4, 4,4,5,4,4,4,3,4,4]'::jsonb, NOW() - INTERVAL '15 days'),

  -- Matt vs Sam (Matt 17, Sam 5.2) — Sam wins both
  (9, 'Torrey Pines',      72, 75.6, 142, 90, 79, '[5,5,4,5,6,5,5,4,5, 5,5,7,5,5,5,3,5,5]'::jsonb, '[5,4,3,4,5,4,4,4,5, 4,4,5,4,4,5,3,4,4]'::jsonb, NOW() - INTERVAL '24 days'),
  (9, 'Bayonne Golf Club', 72, 75.2, 142, 89, 78, '[5,5,4,5,6,5,5,4,5, 5,4,7,5,5,5,3,5,5]'::jsonb, '[4,4,3,4,5,4,4,4,5, 4,4,5,4,4,4,3,5,5]'::jsonb, NOW() - INTERVAL '8 days'),

  -- Matt vs Taylor (Matt 17, Taylor 12.6) — Matt 2, Taylor 1
  (10, 'Bethpage Black',  72, 77.5, 152, 91, 88, '[5,5,4,5,6,5,5,4,5, 5,5,7,5,5,5,3,5,5]'::jsonb, '[5,5,4,5,6,4,5,4,5, 5,4,6,4,5,5,4,5,4]'::jsonb, NOW() - INTERVAL '32 days'),
  (10, 'Bethpage Black',  72, 77.5, 152, 87, 89, '[5,4,4,5,5,5,5,4,5, 5,4,7,4,5,5,3,5,4]'::jsonb, '[5,5,4,5,6,5,5,4,5, 5,4,6,4,5,5,3,5,4]'::jsonb, NOW() - INTERVAL '17 days'),
  (10, 'Bayonne Golf Club', 72, 75.2, 142, 86, 89, '[5,4,4,5,5,5,5,4,5, 5,4,6,4,5,5,3,5,4]'::jsonb, '[5,5,4,5,6,4,5,4,6, 5,4,6,4,5,5,4,5,4]'::jsonb, NOW() - INTERVAL '4 days');

-- For each row: create outing → participants → match_history → rounds.
DO $$
DECLARE
  m           RECORD;
  v_outing_id BIGINT;     -- prefixed to avoid shadowing the column name
  matt_winner BOOLEAN;
  is_tie      BOOLEAN;
BEGIN
  FOR m IN SELECT * FROM _seed_match ORDER BY id LOOP
    -- 1. Create outing
    INSERT INTO tm_outings
      (code, name, host_id, course_name, course_par,
       course_rating, slope_rating,
       team_format, scoring_formats, state, status, created_at, updated_at)
    VALUES
      (UPPER(SUBSTR(MD5(RANDOM()::text), 1, 4)),
       'Seed: Matt vs ' || (SELECT name FROM tm_users WHERE id = m.test_user_id),
       1,
       m.course_name, m.course_par,
       m.course_rating, m.slope_rating,
       'individual', '["stroke"]'::jsonb, '{"holes":18}'::jsonb,
       'closed', m.played_at, m.played_at)
    RETURNING id INTO v_outing_id;

    -- 2. Create participants (Matt + test user)
    matt_winner := m.matt_total < m.test_total;
    is_tie      := m.matt_total = m.test_total;

    INSERT INTO tm_outing_participants
      (outing_id, user_id, scores, total, result, joined_at) VALUES
      (v_outing_id, 1,                m.matt_scores, m.matt_total,
       CASE WHEN is_tie THEN 'tie' WHEN matt_winner THEN 'win' ELSE 'loss' END,
       m.played_at),
      (v_outing_id, m.test_user_id,   m.test_scores, m.test_total,
       CASE WHEN is_tie THEN 'tie' WHEN matt_winner THEN 'loss' ELSE 'win' END,
       m.played_at);

    -- 3. Create match_history (trigger updates tm_h2h_records automatically).
    -- The trigger uses LEAST(winner_id, loser_id) / GREATEST() to canonicalize
    -- the player pair even when is_tie=true, so we MUST set both IDs even
    -- for ties — they identify the two players, and is_tie says "but neither
    -- actually won." (The h2h trigger function in 003_social.sql.)
    INSERT INTO tm_match_history
      (outing_id, winner_id, loser_id, is_tie, winner_score, loser_score, course_name, played_at) VALUES
      (v_outing_id,
       CASE WHEN matt_winner OR is_tie THEN 1              ELSE m.test_user_id END,
       CASE WHEN matt_winner OR is_tie THEN m.test_user_id ELSE 1              END,
       is_tie,
       LEAST(m.matt_total, m.test_total),
       GREATEST(m.matt_total, m.test_total),
       m.course_name,
       m.played_at);

    -- 4. Create tm_rounds rows for each participant so their personal
    -- stats include this match. Mirrors the production match-end
    -- behavior in /api/outings/:code/end.
    INSERT INTO tm_rounds
      (user_id, outing_id, course_name, course_par,
       course_rating, slope_rating, game_type,
       scores, total, date) VALUES
      (1,              v_outing_id, m.course_name, m.course_par,
       m.course_rating, m.slope_rating, 'stroke',
       m.matt_scores, m.matt_total, m.played_at::date),
      (m.test_user_id, v_outing_id, m.course_name, m.course_par,
       m.course_rating, m.slope_rating, 'stroke',
       m.test_scores, m.test_total, m.played_at::date)
    ON CONFLICT (user_id, outing_id) DO NOTHING;
  END LOOP;
END $$;

DROP TABLE _seed_match;

COMMIT;
