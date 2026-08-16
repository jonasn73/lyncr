-- 137: Amber — business-owned private SMS assistant line (Phase 1).
-- Amber texts the verified owner mobile; customer SMS never uses this DID.

-- Flag control lines so customer outbound never picks Amber as From.
ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS is_amber_control BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN phone_numbers.is_amber_control IS
  'True when this DID is the shop Amber assistant line — never customer-facing From.';

CREATE TABLE IF NOT EXISTS amber_workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number_id UUID NOT NULL REFERENCES phone_numbers(id) ON DELETE RESTRICT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Verified personal mobile that may receive Amber texts and issue commands.
  owner_mobile_e164 TEXT,
  owner_mobile_verified_at TIMESTAMPTZ,
  -- When set and in the future, cron flips presence to AVAILABLE at this instant.
  presence_available_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (phone_number_id)
);

-- One Amber setup per shop when organization_id is set.
CREATE UNIQUE INDEX IF NOT EXISTS amber_workspaces_org_unique
  ON amber_workspaces (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS amber_workspaces_user_idx
  ON amber_workspaces (user_id);

CREATE INDEX IF NOT EXISTS amber_workspaces_available_at_idx
  ON amber_workspaces (presence_available_at)
  WHERE presence_available_at IS NOT NULL AND enabled = true;

COMMENT ON TABLE amber_workspaces IS
  'Per-shop Amber assistant: business-owned control DID + verified owner mobile.';

CREATE TABLE IF NOT EXISTS amber_mobile_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  mobile_e164 TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amber_mobile_verifications_user_idx
  ON amber_mobile_verifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS amber_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amber_audit_events_user_created_idx
  ON amber_audit_events (user_id, created_at DESC);

COMMENT ON TABLE amber_audit_events IS
  'Amber timeline: enable, verify, BUSY/AVAILABLE, cron flips, errors.';
