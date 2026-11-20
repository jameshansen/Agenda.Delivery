-- Pushover destinations: an account may give its own Pushover app token instead of using the site's.
-- Apply once with the service stopped, before the new code: sqlite3 /var/lib/agenda/agenda.db < 2026-11-pushover.sql
.bail on
ALTER TABLE target ADD COLUMN token TEXT NOT NULL DEFAULT '';
