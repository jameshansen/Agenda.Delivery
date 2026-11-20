-- Email colours for an account's organization and for each mailing list, "#fg,#bg1,#bg2" or '' for the default.
-- Apply once with the service stopped, before the new code: sqlite3 /var/lib/agenda/agenda.db < 2026-11-colours.sql
.bail on
ALTER TABLE user ADD COLUMN mail_colours TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN mail_colours TEXT NOT NULL DEFAULT '';
