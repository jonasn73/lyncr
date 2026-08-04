-- Admin inbound support inbox (Resend → Neon).
-- Stores emails forwarded into Lyncr admin (e.g. support@lyncr.app via Zoho → inbound subdomain).
-- Run in Neon SQL Editor after 126-latest-attention-book-form.sql.
-- See ADMIN-SUPPORT-INBOX.md for Zoho + DNS setup (do NOT change root MX for lyncr.app).

CREATE TABLE IF NOT EXISTS admin_support_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend receiving email id (unique upsert key)
  provider_email_id TEXT NOT NULL,
  -- RFC Message-ID header when present
  message_id TEXT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  -- Primary display "to" (first recipient, often the Resend inbound address)
  to_email TEXT NOT NULL DEFAULT '',
  to_emails TEXT[] NOT NULL DEFAULT '{}',
  -- Original addresses from Received "for" (e.g. support@lyncr.app when Zoho forwarded)
  received_for TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  -- Webhook + Receiving API metadata (attachments list, headers snapshot, etc.)
  provider_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_support_emails_provider_email_id_key UNIQUE (provider_email_id)
);

CREATE INDEX IF NOT EXISTS admin_support_emails_received_at_idx
  ON admin_support_emails (received_at DESC);

CREATE INDEX IF NOT EXISTS admin_support_emails_read_at_idx
  ON admin_support_emails (read_at NULLS FIRST, received_at DESC);

COMMENT ON TABLE admin_support_emails IS
  'Platform admin inbox: inbound support mail via Resend email.received webhook (Zoho-safe subdomain forward).';
