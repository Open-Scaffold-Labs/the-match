-- 014_tm_users_handle.sql
-- Adds a public handle (e.g. @mlav) to every user account. Auto-
-- generated from firstname + last-initial, with numeric suffix on
-- collision. Surfaces in search rows and profile views for
-- disambiguation when multiple users share a name.
--
-- Sequence:
--   1. Add `handle` TEXT column (nullable for the moment so we can
--      backfill in two passes without violating constraints).
--   2. Set Matt's handle explicitly to 'mlav' so the auto-gen pass
--      doesn't try to claim it for him (and the algorithm wouldn't
--      pick 'mlav' anyway — it'd pick 'mattl').
--   3. Run a PL/pgSQL backfill across remaining users, generating
--      a candidate from name + dedup-suffix until unique.
--   4. Tighten constraints: NOT NULL + UNIQUE + CHECK shape.
--
-- (2026-05-01 — Matt: matt picked @mlav himself; everyone else gets
-- auto-generated.)

-- 1. Add the column
ALTER TABLE tm_users
  ADD COLUMN IF NOT EXISTS handle TEXT;

-- 2. Matt's explicit pick — runs FIRST so the auto-gen pass below
--    sees it as already-claimed and doesn't try to assign 'mlav'
--    to anyone else. Email match is unique.
UPDATE tm_users
SET handle = 'mlav'
WHERE LOWER(email) = 'mlav1114@aol.com'
  AND handle IS NULL;

-- 3. Auto-generate handles for everyone else.
DO $$
DECLARE
  u            RECORD;
  parts        TEXT[];
  first_part   TEXT;
  last_initial TEXT;
  base         TEXT;
  candidate    TEXT;
  suffix       INT;
BEGIN
  FOR u IN
    SELECT id, name, email FROM tm_users
    WHERE handle IS NULL
    ORDER BY id
  LOOP
    -- Split the user's name into whitespace-separated tokens.
    -- regexp_split_to_array on whitespace, with empty fallback.
    parts := regexp_split_to_array(COALESCE(TRIM(u.name), ''), E'\\s+');

    -- First name = lowercase first token, stripped of non-alnum.
    first_part := LOWER(REGEXP_REPLACE(COALESCE(parts[1], ''), '[^a-zA-Z0-9]', '', 'g'));

    -- Last initial = first letter of last token, stripped + lower.
    -- Only when the user has more than one name token.
    last_initial := '';
    IF array_length(parts, 1) IS NOT NULL AND array_length(parts, 1) > 1 THEN
      last_initial := LOWER(REGEXP_REPLACE(parts[array_length(parts, 1)], '[^a-zA-Z0-9]', '', 'g'));
      IF length(last_initial) > 0 THEN
        last_initial := SUBSTR(last_initial, 1, 1);
      END IF;
    END IF;

    base := first_part || last_initial;

    -- Empty-name fallback: use the email's local part (everything
    -- before the @), stripped to alnum. Bound to 12 chars so we don't
    -- end up with grotesque handles for verbose-email users.
    IF length(base) = 0 THEN
      base := LOWER(REGEXP_REPLACE(SPLIT_PART(u.email, '@', 1), '[^a-zA-Z0-9]', '', 'g'));
      base := SUBSTR(base, 1, 12);
    END IF;

    -- Bound the base to ≤16 chars (handle CHECK is ≤20; reserve room
    -- for the numeric suffix).
    base := SUBSTR(base, 1, 16);

    -- Last-resort fallback: the algorithm produced nothing usable.
    IF length(base) < 2 THEN
      base := 'user';
    END IF;

    -- Try base, then base2, base3, ... until we find an unused handle.
    candidate := base;
    suffix    := 1;
    WHILE EXISTS (SELECT 1 FROM tm_users WHERE handle = candidate) LOOP
      suffix    := suffix + 1;
      candidate := base || suffix::TEXT;
    END LOOP;

    UPDATE tm_users SET handle = candidate WHERE id = u.id;
  END LOOP;
END $$;

-- 4. Tighten constraints. handle is now populated for every row.
ALTER TABLE tm_users
  ALTER COLUMN handle SET NOT NULL;

ALTER TABLE tm_users
  ADD CONSTRAINT tm_users_handle_unique UNIQUE (handle);

ALTER TABLE tm_users
  ADD CONSTRAINT tm_users_handle_check
  CHECK (handle ~ '^[a-z0-9_]{2,20}$');

-- Lookup index for case-sensitive equality / prefix searches in the
-- search endpoint. UNIQUE constraint already gives us one but be
-- explicit for the LIKE prefix queries.
CREATE INDEX IF NOT EXISTS tm_users_handle_idx ON tm_users (handle);
