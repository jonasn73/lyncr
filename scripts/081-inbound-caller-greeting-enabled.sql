-- Per-line inbound caller greeting (dashboard toggle).
-- When false, callers hear straight ringback while the team cell rings — no spoken greeting.

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS inbound_caller_greeting_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN routing_config.inbound_caller_greeting_enabled IS
  'When true, callers hear a short greeting before we ring the team. When false, straight ringback to cell.';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS inbound_caller_greeting_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN phone_numbers.inbound_caller_greeting_enabled IS
  'Denormalized from routing_config for fast inbound webhook snapshot reads.';
