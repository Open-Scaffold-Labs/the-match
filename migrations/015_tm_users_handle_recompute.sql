-- 015_tm_users_handle_recompute.sql
-- Updates the handle algorithm to:
--   first initial of first name  +  first three letters of last name
-- e.g. 'Matt Lavin' → 'mlav', 'Sean Lav' → 'slav', 'Dale Johnson' → 'djoh'
-- Single-name users fall back to email-local-part (capped to 12 chars).
-- Empty/garbled fallback: 'user'. Numeric suffix on collision.
--
-- Re-runs across every existing user. The new algorithm happens to
-- produce 'mlav' for 'Matt Lavin' on its own, so Matt no longer
-- needs the explicit override that migration 014 carried.
--
-- Sequence:
--   1. Temporarily drop NOT NULL on handle so we can null everyone
--      out (avoiding mid-loop unique-constraint conflicts).
--   2. NULL all handles.
--   3. PL/pgSQL loop reassigns handles in deterministic id order so
--      Matt (id=1) claims 'mlav' before any later collision could.
--   4. Restore NOT NULL.
--
-- (2026-05-01 — Matt: 'first initial of first name followed by first
-- 3 initials in last name'.)

ALTER TABLE tm_users ALTER COLUMN handle DROP NOT NULL;
UPDATE tm_users SET handle = NULL;

DO $$
DECLARE
  u            RECORD;
  parts        TEXT[];
  first_part   TEXT;
  last_part    TEXT;
  first_init   TEXT;
  last_three   TEXT;
  base         TEXT;
  candidate    TEXT;
  suffix       INT;
BEGIN
  FOR u IN
    SELECT id, name, email FROM tm_users
    ORDER BY id  -- deterministic; earliest accounts get unsuffixed handle
  LOOP
    parts := regexp_split_to_array(COALESCE(TRIM(u.name), ''), E'\\s+');

    -- First initial: first letter of first token, alphanumerics only.
    first_part := LOWER(REGEXP_REPLACE(COALESCE(parts[1], ''), '[^a-zA-Z0-9]', '', 'g'));
    first_init := SUBSTR(first_part, 1, 1);

    -- Last 3: first 3 letters of the last token, alphanumerics only.
    -- Only when the user has more than one name token.
    last_three := '';
    IF array_length(parts, 1) IS NOT NULL AND array_length(parts, 1) > 1 THEN
      last_part  := LOWER(REGEXP_REPLACE(parts[array_length(parts, 1)], '[^a-zA-Z0-9]', '', 'g'));
      last_three := SUBSTR(last_part, 1, 3);
    END IF;

    IF length(first_init) > 0 AND length(last_three) > 0 THEN
      base := first_init || last_three;
    ELSE
      -- Single-name user (or unparseable) — use email-local-part.
      base := LOWER(REGEXP_REPLACE(SPLIT_PART(u.email, '@', 1), '[^a-zA-Z0-9]', '', 'g'));
      base := SUBSTR(base, 1, 12);
    END IF;

    -- Cap base to 16 chars (CHECK is 2-20; reserve room for suffix).
    base := SUBSTR(base, 1, 16);

    -- Last-resort fallback if the algorithm produced nothing usable.
    IF length(base) < 2 THEN
      base := 'user';
    END IF;

    -- Try base, then base2, base3, ... until we find an unused handle.
    candidate := base;
    suffix    := 1;
    WHILE EXISTS (SELECT 1 FROM tm_users WHERE handle = candidate AND id != u.id) LOOP
      suffix    := suffix + 1;
      candidate := base || suffix::TEXT;
    END LOOP;

    UPDATE tm_users SET handle = candidate WHERE id = u.id;
  END LOOP;
END $$;

ALTER TABLE tm_users ALTER COLUMN handle SET NOT NULL;
