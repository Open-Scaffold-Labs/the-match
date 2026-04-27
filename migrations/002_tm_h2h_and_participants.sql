-- The Match — Migration 002
-- Head-to-head records + outing participants
-- Run against your Supabase project via:
--   psql $DATABASE_URL -f migrations/002_tm_h2h_and_participants.sql

-- Outing participants (who's in each outing + their scores)
CREATE TABLE IF NOT EXISTS tm_outing_participants (
  id            BIGSERIAL PRIMARY KEY,
  outing_id     BIGINT      NOT NULL REFERENCES tm_outings(id) ON DELETE CASCADE,
  user_id       BIGINT      NOT NULL REFERENCES tm_users(id)   ON DELETE CASCADE,
  team          TEXT,                         -- 'A' or 'B' for Big Team Battle
  scores        JSONB       NOT NULL DEFAULT '[]',  -- per-hole scores array
  total         INT         NOT NULL DEFAULT 0,
  net_total     INT,                          -- after handicap strokes applied
  result        TEXT,       -- 'win' | 'loss' | 'tie' | null (pending)
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (outing_id, user_id)
);

CREATE INDEX IF NOT EXISTS tm_outing_participants_outing ON tm_outing_participants (outing_id);
CREATE INDEX IF NOT EXISTS tm_outing_participants_user  ON tm_outing_participants (user_id);

-- Head-to-head records (one row per ordered player pair)
-- player_a_id < player_b_id always (enforced by app layer)
CREATE TABLE IF NOT EXISTS tm_h2h_records (
  id            BIGSERIAL PRIMARY KEY,
  player_a_id   BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  player_b_id   BIGINT      NOT NULL REFERENCES tm_users(id) ON DELETE CASCADE,
  a_wins        INT         NOT NULL DEFAULT 0,
  b_wins        INT         NOT NULL DEFAULT 0,
  ties          INT         NOT NULL DEFAULT 0,
  last_played   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (player_a_id, player_b_id),
  CHECK (player_a_id < player_b_id)
);

CREATE INDEX IF NOT EXISTS tm_h2h_player_a ON tm_h2h_records (player_a_id);
CREATE INDEX IF NOT EXISTS tm_h2h_player_b ON tm_h2h_records (player_b_id);

-- Match history log (each outing result between two players)
CREATE TABLE IF NOT EXISTS tm_match_history (
  id            BIGSERIAL PRIMARY KEY,
  outing_id     BIGINT      NOT NULL REFERENCES tm_outings(id) ON DELETE CASCADE,
  winner_id     BIGINT      REFERENCES tm_users(id) ON DELETE SET NULL,
  loser_id      BIGINT      REFERENCES tm_users(id) ON DELETE SET NULL,
  is_tie        BOOLEAN     NOT NULL DEFAULT FALSE,
  winner_score  INT,
  loser_score   INT,
  course_name   TEXT,
  played_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tm_match_history_outing   ON tm_match_history (outing_id);
CREATE INDEX IF NOT EXISTS tm_match_history_winner   ON tm_match_history (winner_id);
CREATE INDEX IF NOT EXISTS tm_match_history_loser    ON tm_match_history (loser_id);

-- Trigger to update tm_h2h_records when a match_history row is inserted
CREATE OR REPLACE FUNCTION tm_update_h2h()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  pa BIGINT; pb BIGINT;
BEGIN
  IF NEW.is_tie THEN
    pa := LEAST(NEW.winner_id, NEW.loser_id);
    pb := GREATEST(NEW.winner_id, NEW.loser_id);
    INSERT INTO tm_h2h_records (player_a_id, player_b_id, ties, last_played)
      VALUES (pa, pb, 1, NEW.played_at)
      ON CONFLICT (player_a_id, player_b_id) DO UPDATE
        SET ties = tm_h2h_records.ties + 1,
            last_played = EXCLUDED.last_played,
            updated_at = NOW();
  ELSE
    pa := LEAST(NEW.winner_id, NEW.loser_id);
    pb := GREATEST(NEW.winner_id, NEW.loser_id);
    INSERT INTO tm_h2h_records (player_a_id, player_b_id,
      a_wins, b_wins, last_played)
    VALUES (
      pa, pb,
      CASE WHEN NEW.winner_id = pa THEN 1 ELSE 0 END,
      CASE WHEN NEW.winner_id = pb THEN 1 ELSE 0 END,
      NEW.played_at
    )
    ON CONFLICT (player_a_id, player_b_id) DO UPDATE
      SET a_wins = tm_h2h_records.a_wins +
            CASE WHEN NEW.winner_id = tm_h2h_records.player_a_id THEN 1 ELSE 0 END,
          b_wins = tm_h2h_records.b_wins +
            CASE WHEN NEW.winner_id = tm_h2h_records.player_b_id THEN 1 ELSE 0 END,
          last_played = EXCLUDED.last_played,
          updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tm_match_history_h2h
  AFTER INSERT ON tm_match_history
  FOR EACH ROW EXECUTE FUNCTION tm_update_h2h();

-- Updated_at trigger for h2h_records (also covered by the function above)
CREATE TRIGGER tm_h2h_updated_at
  BEFORE UPDATE ON tm_h2h_records
  FOR EACH ROW EXECUTE FUNCTION tm_set_updated_at();
