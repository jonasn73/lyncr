-- 069: Two-way SMS thread storage (inbound webhook + outbound send from dashboard).
-- Run in Neon SQL Editor after 068-10dlc-multi-tenant.sql.

CREATE TABLE IF NOT EXISTS sms_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone_number_id UUID REFERENCES phone_numbers(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  customer_phone TEXT NOT NULL,
  telnyx_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sms_messages_org_created_idx
  ON sms_messages (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sms_messages_thread_idx
  ON sms_messages (organization_id, customer_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS sms_messages_owner_idx
  ON sms_messages (owner_user_id, created_at DESC);

COMMENT ON TABLE sms_messages IS 'Customer SMS threads per workspace — populated by Telnyx message.received webhook and POST /api/messaging/send.';
