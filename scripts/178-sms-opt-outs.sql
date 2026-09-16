-- Customer SMS opt-outs (replied STOP to a shop line). Mirrors the carrier-level
-- block Telnyx applies for 10DLC so our automations stop attempting sends (they
-- otherwise just fail at the carrier and read as errors) and manual Messages
-- sends get a clear "customer opted out" error instead of a mystery failure.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  -- Last-10 digits, normalized — matches how the rest of the app compares phones.
  phone_digits text NOT NULL,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  source text,
  UNIQUE (owner_user_id, phone_digits)
);
