-- 065: Multi-business workspaces + externally linked lines (Twilio transfer / TeXML).
-- Run in Neon SQL Editor after 064-tech-invite-link.sql.
--
-- Owners can operate multiple independent businesses (organizations) under one login.
-- Each phone_numbers row belongs to an organization (not only a flat user_id).
-- External lines are registered without a Telnyx purchase — callers forward to our TeXML webhook.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_owner_idx ON organizations (owner_user_id, created_at ASC);

-- One default workspace per owner (partial unique index).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_owner_default_uidx
  ON organizations (owner_user_id)
  WHERE is_default = true;

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS source_provider TEXT NOT NULL DEFAULT 'telnyx';

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS external_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN phone_numbers.organization_id IS 'Workspace this line belongs to (multi-business owners).';
COMMENT ON COLUMN phone_numbers.source_provider IS 'telnyx = purchased on Lyncr, external = forwarded from Twilio/other carrier.';
COMMENT ON COLUMN phone_numbers.external_verified IS 'True when owner linked an external DID and pointed webhooks at Lyncr TeXML.';

CREATE INDEX IF NOT EXISTS phone_numbers_organization_idx ON phone_numbers (organization_id, status);

-- Backfill: one default organization per owner from business_name, attach existing lines.
INSERT INTO organizations (id, owner_user_id, name, is_default)
SELECT gen_random_uuid(), u.id, COALESCE(NULLIF(TRIM(u.business_name), ''), NULLIF(TRIM(u.name), ''), 'My Business'), true
FROM users u
WHERE COALESCE(u.account_role, 'owner') = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM organizations o WHERE o.owner_user_id = u.id AND o.is_default = true
  );

UPDATE phone_numbers pn
SET organization_id = o.id
FROM organizations o
WHERE o.owner_user_id = pn.user_id
  AND o.is_default = true
  AND pn.organization_id IS NULL;
