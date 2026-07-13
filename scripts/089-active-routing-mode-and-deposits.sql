-- Unified Lines routing mode + booking deposit holds.

-- Primary radio mode for Who Answers (your_phone | smart_ivr | lyncr_pool | custom_routing).
ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS active_routing_mode TEXT NOT NULL DEFAULT 'your_phone';

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS custom_routing_phone TEXT;

COMMENT ON COLUMN routing_config.active_routing_mode IS
  'Unified Lines mode: your_phone | smart_ivr | lyncr_pool | custom_routing.';

COMMENT ON COLUMN routing_config.custom_routing_phone IS
  'E.164 target when active_routing_mode = custom_routing.';

-- Account-level deposit gate for public /book.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS require_deposit BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.require_deposit IS
  'When true, /book requires Stripe checkout before confirming a slot.';

-- Pending booking holds awaiting Stripe payment.
CREATE TABLE IF NOT EXISTS booking_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_line TEXT,
  customer_phone TEXT,
  customer_name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 2500,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'cancelled')),
  stripe_checkout_session_id TEXT,
  lead_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_holds_owner_status
  ON booking_holds (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_booking_holds_session
  ON booking_holds (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

-- Track IVR digit success so missed-call rescue can skip completed menu flows.
ALTER TABLE call_logs
  ADD COLUMN IF NOT EXISTS ivr_action_completed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN call_logs.ivr_action_completed IS
  'True when IVR Digit 1/2 completed successfully — skips Missed Call Rescue SMS.';
