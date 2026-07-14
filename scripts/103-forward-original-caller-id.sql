-- Per-line "Forward Caller ID" toggle (dashboard Ring & Backup / line details).
-- When false (default): cell shows the Lyncr business DID so you know it is a business lead.
-- When true: cell shows the original customer's number on the forwarded dial leg.

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS forward_original_caller_id BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN routing_config.forward_original_caller_id IS
  'When true, inbound forwards show the customer number as caller ID. When false, show the Lyncr business DID.';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS forward_original_caller_id BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN phone_numbers.forward_original_caller_id IS
  'Denormalized from routing_config for fast inbound webhook snapshot reads.';
