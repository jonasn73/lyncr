-- 138: Amber coworker — leftover book-form pings + owner-approved customer drafts.
-- Amber texts the owner; customer SMS still goes from the shop line after SEND.

ALTER TABLE amber_workspaces
  ADD COLUMN IF NOT EXISTS coworker_paused_at TIMESTAMPTZ;

COMMENT ON COLUMN amber_workspaces.coworker_paused_at IS
  'When set, Amber stops leftover-job pings (owner STOP). START or Settings clears it.';

-- One conversation per leftover book-form lead.
CREATE TABLE IF NOT EXISTS amber_job_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amber_workspace_id UUID NOT NULL REFERENCES amber_workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  lead_id UUID NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_name TEXT,
  job_label TEXT,
  address_snippet TEXT,
  urgency TEXT NOT NULL DEFAULT 'window',
  state TEXT NOT NULL DEFAULT 'awaiting_instruction',
  draft_body TEXT,
  draft_expires_at TIMESTAMPTZ,
  last_instruction TEXT,
  pinged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lead_id)
);

CREATE INDEX IF NOT EXISTS amber_job_threads_user_state_idx
  ON amber_job_threads (user_id, state, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS amber_job_threads_one_open_per_workspace
  ON amber_job_threads (amber_workspace_id)
  WHERE state IN ('awaiting_instruction', 'awaiting_send');

COMMENT ON TABLE amber_job_threads IS
  'Amber leftover book-form coworker: ask owner → draft → SEND/SKIP.';

-- Ignore duplicate Telnyx inbound retries before SEND.
CREATE TABLE IF NOT EXISTS amber_inbound_seen (
  telnyx_message_id TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amber_inbound_seen_seen_at_idx
  ON amber_inbound_seen (seen_at);
