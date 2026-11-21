-- Summaries can be written in Markdown, which the site and email show formatted. It starts on for every monitor.
.bail on
ALTER TABLE monitor ADD COLUMN summary_markdown INTEGER NOT NULL DEFAULT 1;
