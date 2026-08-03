-- 125: Activity "Send book link" — customer intake form (+ optional pay).
-- Owner texts a short link from Activity; customer fills name/address/vehicle;
-- submit creates/updates CRM + ai_leads. Paid modes reuse collect_pay_links.

CREATE TABLE IF NOT EXISTS intake_book_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Caller phone from the Activity row (E.164 preferred)
  caller_phone TEXT NOT NULL,
  -- Business DID used for SMS (optional)
  business_line TEXT,
  -- Optional call_logs.id that triggered the send
  call_log_id TEXT,
  -- none | service_call | full_quote
  fee_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (fee_mode IN ('none', 'service_call', 'full_quote')),
  -- Cents to charge after the form (0 when fee_mode = none)
  quote_cents INTEGER NOT NULL DEFAULT 0,
  -- Optional short note from the owner (shown / logged)
  operator_note TEXT NOT NULL DEFAULT '',
  -- Opaque collect_pay_links.token when payment is required
  pay_token TEXT,
  -- ai_leads.id filled after the customer submits the form
  job_id TEXT,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

CREATE INDEX IF NOT EXISTS intake_book_links_owner_created_idx
  ON intake_book_links (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS intake_book_links_phone_idx
  ON intake_book_links (owner_user_id, caller_phone);

COMMENT ON TABLE intake_book_links IS
  'Activity Send book link invites — public /book/form/{id} intake (+ optional Stripe pay).';
