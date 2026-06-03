-- 059: Mobile cell fallback — post-call SMS outcome capture.
-- Run in Neon SQL Editor after 058-lead-disposition.sql.
--
-- When a receptionist fields a forwarded call on their personal cell, we text them an outcome-code
-- prompt at hang-up (POST /api/voice/telnyx/status) and parse their numeric reply
-- (POST /api/webhooks/telnyx/messaging). pending_sms_dispositions links the texted cell back to the
-- exact call so the reply lands on the right call log; call_logs.disposition records the final outcome.

ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS disposition TEXT;

COMMENT ON COLUMN call_logs.disposition IS 'Final operator outcome: BOOKED | PENDING_TIME | PRICE_REJECTED | FAILED.';

CREATE TABLE IF NOT EXISTS pending_sms_dispositions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_log_id UUID,                       -- call_logs.id (best-effort link)
  provider_call_sid TEXT NOT NULL,        -- the call we texted about (idempotency key)
  receptionist_id UUID,
  receptionist_name TEXT,
  receptionist_phone_e164 TEXT NOT NULL,  -- the cell we texted; matched against inbound SMS "from"
  caller_number TEXT,
  business_name TEXT,
  status TEXT,                            -- filled when the operator replies (1-4 -> ENUM)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE (provider_call_sid)
);

-- Newest open prompt for a given cell — the inbound SMS parser claims by phone.
CREATE INDEX IF NOT EXISTS pending_sms_dispositions_phone_idx
  ON pending_sms_dispositions (receptionist_phone_e164, responded_at, created_at DESC);
