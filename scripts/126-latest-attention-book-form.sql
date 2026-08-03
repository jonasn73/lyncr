-- Allow Latest-attention SMS for customer book-form submits (ASAP / window).
-- Extends scripts/122-sms-latest-attention.sql check constraint.
-- Run in Neon SQL Editor after 125-intake-book-links.sql.

ALTER TABLE latest_attention_sms_sent
  DROP CONSTRAINT IF EXISTS latest_attention_sms_sent_event_check;

ALTER TABLE latest_attention_sms_sent
  ADD CONSTRAINT latest_attention_sms_sent_event_check
  CHECK (event_type IN ('replied', 'job_finished', 'book_form'));

COMMENT ON TABLE latest_attention_sms_sent IS
  'Tracks Latest-attention owner SMS sends for rate-limiting (replied cooldown / one per job or book-form lead).';
