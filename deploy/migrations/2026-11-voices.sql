-- Voices: each account's summary instructions become named voices its monitors share. Monitors with the same
-- instructions share one voice, the one most of an account's monitors use is its default, and each monitor keeps
-- writing exactly as it did. Apply after 2026-11-summary-markdown.sql.
.bail on
BEGIN;
CREATE TABLE IF NOT EXISTS voice (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  markdown    INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE monitor ADD COLUMN voice_id INTEGER REFERENCES voice(id) ON DELETE SET NULL;
ALTER TABLE monitor ADD COLUMN voice_note TEXT NOT NULL DEFAULT '';
INSERT INTO voice (user_id, name, prompt, markdown)
  SELECT user_id, '', summary_prompt, summary_markdown FROM monitor GROUP BY user_id, summary_prompt, summary_markdown;
UPDATE monitor SET voice_id = (SELECT v.id FROM voice v WHERE v.user_id = monitor.user_id
  AND v.prompt = monitor.summary_prompt AND v.markdown = monitor.summary_markdown);
UPDATE voice SET name = CASE WHEN prompt = 'Start with 2 to 4 sentences as one flowing paragraph, like a short news item, not a report. Write it the way you''d describe the meeting to someone out loud, with one topic flowing into the next, and focus on the most significant decisions and discussions. Keep labels out of that paragraph: don''t write "Topic: detail" one per sentence (for example "Infrastructure: council approved X. Housing: council discussed Y."), which is a list dressed up as prose. Then leave a blank line and list the 3 to 5 most significant items as highlights, one per line: a bullet, a short tag, a colon, and one sentence.' THEN 'News summary'
  ELSE (SELECT m.name FROM monitor m WHERE m.voice_id = voice.id ORDER BY m.num LIMIT 1) || ' voice' END;
UPDATE voice SET is_default = 1 WHERE id = (SELECT m.voice_id FROM monitor m WHERE m.user_id = voice.user_id
  GROUP BY m.voice_id ORDER BY count(*) DESC, m.voice_id LIMIT 1);
COMMIT;
