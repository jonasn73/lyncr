-- 141: Backfill provider_number_sid from the legacy twilio_sid column.
--
-- RUN THIS **BEFORE** DEPLOYING the code that drops the twilio_sid fallbacks.
--
-- Migration 008 backfilled provider_number_sid once, but rows created afterwards on the
-- legacy path never got one. As of writing, 1 of 10 phone_numbers rows still has an empty
-- provider_number_sid and a populated twilio_sid — that line stays routable today only
-- because primary-business-line.ts / telnyx-sms.ts fall back to twilio_sid. Removing those
-- fallbacks without this backfill drops the line out of SMS and primary-line resolution.
--
-- Safe to run multiple times.

UPDATE phone_numbers
SET provider_number_sid = twilio_sid
WHERE (provider_number_sid IS NULL OR provider_number_sid = '')
  AND twilio_sid IS NOT NULL
  AND twilio_sid <> '';

-- Verify: must return 0 before you deploy.
-- SELECT count(*) FROM phone_numbers
--  WHERE (provider_number_sid IS NULL OR provider_number_sid = '');
