-- 055: Owner-authored instructions for the live Lyncr operator network.
-- Run in Neon SQL Editor after 054-receptionist-invite-stub.sql.
--
-- Free-text notes (business hours, pricing scripts, greeting, what to collect) that the business
-- owner saves on the Team page. Shown to the live receptionists answering this business's calls.

ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS routing_instructions TEXT;

COMMENT ON COLUMN onboarding_profiles.routing_instructions IS 'Owner-authored script/notes shown to live Lyncr network operators answering this business line.';
