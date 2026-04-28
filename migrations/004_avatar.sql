-- 004_avatar.sql  — add player card avatar column
ALTER TABLE tm_users ADD COLUMN IF NOT EXISTS avatar TEXT;
