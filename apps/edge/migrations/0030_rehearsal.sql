-- Rehearsals (release 1.6.0): a rehearsal is a game record of its own, pointing to its real game. Apply BEFORE deploying the code that writes it.
ALTER TABLE engagement ADD COLUMN rehearsal_of TEXT;
ALTER TABLE engagement ADD COLUMN run_no INTEGER;
ALTER TABLE engagement ADD COLUMN rehearsal_closed_ms INTEGER;
CREATE INDEX IF NOT EXISTS engagement_rehearsal ON engagement(rehearsal_of);
