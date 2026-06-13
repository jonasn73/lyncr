-- 070: Store carrier rejection text on porting_orders (PIN/LOA corrections from Telnyx webhooks).
-- Run in Neon SQL Editor after 069-sms-messages.sql.

ALTER TABLE porting_orders
  ADD COLUMN IF NOT EXISTS carrier_rejection_reason TEXT;

COMMENT ON COLUMN porting_orders.carrier_rejection_reason IS
  'Latest carrier rejection or action-required comment (e.g. invalid PIN) from Telnyx porting webhooks.';
