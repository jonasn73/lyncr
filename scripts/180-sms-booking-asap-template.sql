-- Separate booking-confirmation copy for ASAP jobs. "Booked for ASAP" reads
-- wrong and the owner wants urgency conveyed without the word ASAP; windows
-- keep the regular template (which may include the time). Empty = fall back
-- to sms_booking_template, so existing tenants are unchanged.
ALTER TABLE onboarding_profiles ADD COLUMN IF NOT EXISTS sms_booking_asap_template text;
