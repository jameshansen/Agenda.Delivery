-- Keeps every summary with the instructions it was written from. Summaries already written start the history,
-- without their instructions, which weren't kept.
.bail on
BEGIN;
CREATE TABLE IF NOT EXISTS summary (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  item_id     INTEGER NOT NULL,
  prompt      TEXT,
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS summary_item ON summary (monitor_id, kind, item_id, id);
INSERT INTO summary (monitor_id, kind, item_id, text, created_at)
  SELECT monitor_id, 'agenda', id, summary, found_at FROM agenda WHERE summary != ''
  AND NOT EXISTS (SELECT 1 FROM summary s WHERE s.kind = 'agenda' AND s.item_id = agenda.id);
INSERT INTO summary (monitor_id, kind, item_id, text, created_at)
  SELECT monitor_id, 'video', id, summary, found_at FROM video WHERE summary != ''
  AND NOT EXISTS (SELECT 1 FROM summary s WHERE s.kind = 'video' AND s.item_id = video.id);
COMMIT;
