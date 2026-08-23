-- 142: Retire the legacy Twilio columns now that everything reads provider-neutral ids.
--
-- RUN THIS **AFTER** deploying the code that no longer selects twilio_sid /
-- twilio_call_sid. Dropping them while the old code is live would break its SELECTs.
-- Run 141 first — it backfills the rows these drops would otherwise strand.
--
-- Both columns were NOT NULL DEFAULT '', which is what forced the awkward
-- "duplicate the sid into both columns" INSERT path in lib/db.ts.
--
-- call_logs.twilio_call_sid held '' on all 1067 rows (provider_call_sid was populated on
-- every one), so nothing is lost there. phone_numbers.twilio_sid is only dropped after 141
-- has copied it into provider_number_sid.
--
-- Safe to run multiple times.

ALTER TABLE call_logs DROP COLUMN IF EXISTS twilio_call_sid;
ALTER TABLE phone_numbers DROP COLUMN IF EXISTS twilio_sid;
