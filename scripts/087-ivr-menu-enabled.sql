-- Traditional IVR menu master switch (Off-duty → /api/telnyx-menu vs ring Your phone).

ALTER TABLE routing_config
  ADD COLUMN IF NOT EXISTS ivr_menu_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN routing_config.ivr_menu_enabled IS
  'When true, inbound calls for this line Redirect to /api/telnyx-menu instead of ringing the owner cell.';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS ivr_menu_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN phone_numbers.ivr_menu_enabled IS
  'Denormalized IVR menu switch for fast inbound webhook reads.';
