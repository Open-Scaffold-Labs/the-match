-- 024_tm_user_deletion_fk_relax.sql
--
-- Make user deletion possible by relaxing two FK constraints that currently
-- block DELETE FROM tm_users:
--
--   1. tm_outings.host_id was NOT NULL with ON DELETE NO ACTION. A user
--      who has hosted any outing cannot be deleted because the FK refuses.
--      Switch to NULLABLE + ON DELETE SET NULL — the outing record stays
--      (other players' data is preserved), but the host link becomes NULL
--      to indicate the host left the platform.
--
--   2. tm_score_audit.edited_by_id was already NULLABLE but had ON DELETE
--      NO ACTION. Switch to ON DELETE SET NULL for the same reason —
--      preserve the audit log entry, anonymize the editor.
--
-- This is a prerequisite for the DELETE /api/me endpoint (App Store
-- account-deletion compliance — POST-LAUNCH-TODO #11).
--
-- Found 2026-05-07 during the user-deletion FK chain audit.

BEGIN;

-- 1. tm_outings.host_id
ALTER TABLE tm_outings
  ALTER COLUMN host_id DROP NOT NULL;

ALTER TABLE tm_outings
  DROP CONSTRAINT tm_outings_host_id_fkey;

ALTER TABLE tm_outings
  ADD CONSTRAINT tm_outings_host_id_fkey
  FOREIGN KEY (host_id) REFERENCES tm_users(id) ON DELETE SET NULL;

-- 2. tm_score_audit.edited_by_id
ALTER TABLE tm_score_audit
  DROP CONSTRAINT tm_score_audit_edited_by_id_fkey;

ALTER TABLE tm_score_audit
  ADD CONSTRAINT tm_score_audit_edited_by_id_fkey
  FOREIGN KEY (edited_by_id) REFERENCES tm_users(id) ON DELETE SET NULL;

COMMIT;
