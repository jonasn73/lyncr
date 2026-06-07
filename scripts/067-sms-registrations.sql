-- 067: Per-organization SMS / A2P 10DLC compliance registration (dashboard form).
-- Run in Neon SQL Editor after 066-porting-orders.sql.

CREATE TABLE IF NOT EXISTS sms_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  legal_business_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  tax_id_ein TEXT,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  use_case_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sms_registrations_org_uidx
  ON sms_registrations (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sms_registrations_owner_uidx
  ON sms_registrations (owner_user_id)
  WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS sms_registrations_owner_idx ON sms_registrations (owner_user_id, updated_at DESC);

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS sms_registration_status TEXT;

COMMENT ON TABLE sms_registrations IS 'Owner-submitted carrier compliance metadata for A2P 10DLC (Settings → SMS registration tab).';
COMMENT ON COLUMN organizations.sms_registration_status IS 'NONE | PENDING_APPROVAL | APPROVED | REJECTED — mirrors latest sms_registrations row for the workspace.';
