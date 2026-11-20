-- Notifications: default destinations, pausing, digests, mailing lists and delivery history.
-- Apply once to a database made before this change, with the service stopped and BEFORE the new code is installed:
--   sqlite3 /var/lib/agenda/agenda.db < deploy/migrations/2026-11-notifications.sql
-- The new tables (list_member, mail_block, digest_item) are made by src/schema.sql on the next connect.
.bail on
PRAGMA foreign_keys = ON;
BEGIN;

ALTER TABLE target ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
ALTER TABLE target ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE target ADD COLUMN digest TEXT NOT NULL DEFAULT 'now';
ALTER TABLE target ADD COLUMN digest_day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE target ADD COLUMN unsub_token TEXT;
ALTER TABLE target ADD COLUMN sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN reply_to_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE target ADD COLUMN intro TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN footer TEXT NOT NULL DEFAULT '';

ALTER TABLE delivery ADD COLUMN state TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE delivery ADD COLUMN recipients INTEGER NOT NULL DEFAULT 0;
UPDATE delivery SET state = 'failed' WHERE ok = 0;

-- Every account gets its default destination. An account that already added its own address keeps that one,
-- and the rules on it, as the default; everyone else gets a new one.
UPDATE target SET is_default = 1 WHERE id IN (
  SELECT min(t.id) FROM target t JOIN user u ON u.id = t.user_id
  WHERE t.kind = 'email' AND t.address = u.email COLLATE NOCASE GROUP BY t.user_id);
UPDATE target SET confirmed = 1, confirm_hash = NULL WHERE is_default = 1;
INSERT INTO target (user_id, kind, name, address, confirmed, is_default)
  SELECT u.id, 'email', 'My email', u.email, 1, 1 FROM user u
  WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.user_id = u.id AND t.is_default = 1);
CREATE UNIQUE INDEX IF NOT EXISTS target_default ON target (user_id) WHERE is_default = 1;

COMMIT;
