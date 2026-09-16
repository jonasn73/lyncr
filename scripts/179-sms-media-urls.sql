-- Inbound MMS media (customer photos of keys / VINs / doors) were silently
-- dropped — the webhook only read text. Store the media URLs so Messages can
-- show them. Array of https URLs from Telnyx's inbound payload.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS media_urls jsonb;
