-- Hold-queue intake answers — Neon migration 170
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- Powers "smart hold" (Phase 1): a caller on hold answers one quick,
-- industry-tailored question by keypad before a human picks up, and the
-- answer shows up live on Lines before the operator presses Answer.

ALTER TABLE call_queue
  ADD COLUMN IF NOT EXISTS collected jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN call_queue.collected IS
  'Answers captured from the caller while on hold (e.g. {"intent_slug":"locksmith_vehicle","intent_label":"Vehicle key / lockout"}). Merged like ai_leads.collected — never overwritten wholesale.';
