-- WhatsApp destinations: the state each one's bridge reports, and whether its owner was told it dropped.
-- Apply once with the service stopped, before the new code: sqlite3 /var/lib/agenda/agenda.db < 2026-11-whatsapp.sql
.bail on
ALTER TABLE target ADD COLUMN wa_state TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN wa_since TEXT;
ALTER TABLE target ADD COLUMN wa_me TEXT NOT NULL DEFAULT '';
ALTER TABLE target ADD COLUMN wa_linked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE target ADD COLUMN wa_alerted INTEGER NOT NULL DEFAULT 0;
