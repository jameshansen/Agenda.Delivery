-- Branding: the organization name and logo an account's mail goes out under, and a logo of its own for a mailing list.
-- Apply once, with the service stopped:
--   sudo -u agenda sqlite3 /var/lib/agenda/agenda.db < deploy/migrations/2026-11-branding.sql
-- Apply it before the new code is installed. Code from before this change keeps working with the new columns.
.bail on
BEGIN;
ALTER TABLE user ADD COLUMN org_name TEXT NOT NULL DEFAULT '';
ALTER TABLE user ADD COLUMN logo TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN logo TEXT NOT NULL DEFAULT '';
-- How a mailing list sends: agenda (plain agenda.delivery), account (the name and logo in Settings) or list (its own).
-- A list that already had a sender name keeps sending under it.
ALTER TABLE target ADD COLUMN brand TEXT NOT NULL DEFAULT 'agenda';
UPDATE target SET brand = 'list' WHERE kind = 'list' AND sender_name != '';
COMMIT;
