-- A scheduled check is skipped when the site's links and videos match the last full run.
.bail on
ALTER TABLE agent ADD COLUMN fingerprint TEXT;
ALTER TABLE agent ADD COLUMN full_run_at TEXT;
