-- Every Terms tick: who (an opaque id), which point, which game or payment, the Terms version, the boxes, a hash of the exact wording shown, the time.
-- No IP address, no browser details and no phone number. A participant's rows are erased with the game's other participant data. Safe to repeat. test/migrations.test.ts keeps this identical to CONSENT_SCHEMA.
CREATE TABLE IF NOT EXISTS consent_log (id TEXT PRIMARY KEY, subject TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, version TEXT NOT NULL, boxes TEXT NOT NULL, text_hash TEXT NOT NULL, at_ms INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS consent_log_ref ON consent_log (kind, ref);
CREATE INDEX IF NOT EXISTS consent_log_subject ON consent_log (subject, kind, version);
