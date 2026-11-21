-- Each summary revision keeps the name of the voice it was written in and the monitor's note, beside the voice's instructions.
.bail on
ALTER TABLE summary ADD COLUMN voice_name TEXT;
ALTER TABLE summary ADD COLUMN note TEXT NOT NULL DEFAULT '';
