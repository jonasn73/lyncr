-- SMS carrier delivery timestamps + tracked review links (click opens).

ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT;

CREATE INDEX IF NOT EXISTS sms_messages_telnyx_id_idx
  ON sms_messages (telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS review_link_tokens (
  token TEXT PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id UUID,
  destination_url TEXT NOT NULL,
  customer_phone TEXT,
  click_count INTEGER NOT NULL DEFAULT 0,
  first_clicked_at TIMESTAMPTZ,
  last_clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_link_tokens_owner_created_idx
  ON review_link_tokens (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS review_link_tokens_lead_idx
  ON review_link_tokens (lead_id)
  WHERE lead_id IS NOT NULL;

COMMENT ON TABLE review_link_tokens IS
  'Short lyncr.app/rv/{token} links in review SMS — redirect to Google + click counts.';
