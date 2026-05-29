-- 10DLC messaging registration (A2P SMS compliance) — one row per business owner.
-- Lets each business register their own brand + campaign with The Campaign Registry
-- (via Telnyx) directly inside lyncr so SMS lead alerts actually deliver on US carriers.
-- See lib/telnyx-10dlc.ts + lib/messaging-10dlc.ts.

CREATE TABLE IF NOT EXISTS messaging_10dlc_registrations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  -- Brand (business identity) submitted to The Campaign Registry
  entity_type TEXT,                 -- SOLE_PROPRIETOR | PRIVATE_PROFIT | NON_PROFIT | PUBLIC_PROFIT
  legal_company_name TEXT,          -- legal name (required for non sole-prop)
  display_name TEXT,                -- DBA / marketing name
  ein TEXT,                         -- tax id (null for sole proprietor)
  vertical TEXT,                    -- TCR business vertical (e.g. REAL_ESTATE, PROFESSIONAL)
  website TEXT,
  contact_first_name TEXT,
  contact_last_name TEXT,
  email TEXT,
  phone TEXT,                       -- business contact phone (E.164)
  street TEXT,
  city TEXT,
  state TEXT,                       -- 2-letter for US
  postal_code TEXT,
  country TEXT DEFAULT 'US',

  -- Campaign (what we text + how recipients consented)
  use_case TEXT,                    -- SOLE_PROPRIETOR | LOW_VOLUME | ...
  campaign_description TEXT,
  sample_message_1 TEXT,
  sample_message_2 TEXT,
  message_flow TEXT,                -- opt-in description

  -- Telnyx / registry identifiers + assignment
  brand_id TEXT,
  campaign_id TEXT,
  assigned_number TEXT,             -- E.164 of the line attached to the approved campaign

  -- Lifecycle: draft | pending_payment | paid | submitted | pending_review | approved | rejected | failed
  status TEXT NOT NULL DEFAULT 'draft',
  status_detail TEXT,

  -- Pass-through billing
  fee_cents INTEGER NOT NULL DEFAULT 0,
  fee_paid BOOLEAN NOT NULL DEFAULT false,
  stripe_session_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_10dlc_status ON messaging_10dlc_registrations(status);
CREATE INDEX IF NOT EXISTS idx_10dlc_campaign ON messaging_10dlc_registrations(campaign_id);
