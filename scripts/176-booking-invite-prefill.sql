-- Booking invites carry the hold-intake answers (intent + vehicle year) so the
-- public /book form can pre-fill what the caller already told the IVR, instead of
-- the SMS dumping those details as text ("We've got: …") and asking them to re-type
-- everything. Shape mirrors call_queue.collected: { intent_slug, intent_label, vehicle_year }.
ALTER TABLE booking_invites ADD COLUMN IF NOT EXISTS prefill jsonb;
