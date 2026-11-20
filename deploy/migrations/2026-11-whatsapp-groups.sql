-- WhatsApp sends only to groups: the chosen group's name, and any number or own-chat address cleared so a group is chosen.
-- Apply once with the service stopped, before the new code.
.bail on
ALTER TABLE target ADD COLUMN wa_group TEXT NOT NULL DEFAULT '';
UPDATE target SET address = '' WHERE kind = 'whatsapp' AND address NOT LIKE '%@g.us';
