-- 068: Multi-tenant 10DLC — one brand/campaign registration per organization workspace.
-- Run in Neon SQL Editor after 067-sms-registrations.sql.

-- 1) Surrogate primary key (allows multiple Telnyx rows per owner — one per workspace)
ALTER TABLE messaging_10dlc_registrations
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE messaging_10dlc_registrations
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE messaging_10dlc_registrations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE messaging_10dlc_registrations
  ALTER COLUMN id SET NOT NULL;

-- 2) Tie each Telnyx registration row to a workspace
ALTER TABLE messaging_10dlc_registrations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE messaging_10dlc_registrations m
SET organization_id = d.org_id
FROM (
  SELECT DISTINCT ON (owner_user_id) id AS org_id, owner_user_id
  FROM organizations
  ORDER BY owner_user_id, is_default DESC NULLS LAST, created_at ASC
) d
WHERE m.organization_id IS NULL
  AND d.owner_user_id = m.user_id;

-- 3) Replace user_id primary key with id; enforce one registration per workspace
ALTER TABLE messaging_10dlc_registrations
  DROP CONSTRAINT IF EXISTS messaging_10dlc_registrations_pkey;

ALTER TABLE messaging_10dlc_registrations
  ADD PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS messaging_10dlc_registrations_org_uidx
  ON messaging_10dlc_registrations (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS messaging_10dlc_registrations_user_idx
  ON messaging_10dlc_registrations (user_id);

CREATE INDEX IF NOT EXISTS messaging_10dlc_registrations_user_org_idx
  ON messaging_10dlc_registrations (user_id, organization_id);

-- 4) sms_registrations: org-only scope (drop owner-global fallback index)
DROP INDEX IF EXISTS sms_registrations_owner_uidx;

UPDATE sms_registrations sr
SET organization_id = d.org_id
FROM (
  SELECT DISTINCT ON (owner_user_id) id AS org_id, owner_user_id
  FROM organizations
  ORDER BY owner_user_id, is_default DESC NULLS LAST, created_at ASC
) d
WHERE sr.organization_id IS NULL
  AND d.owner_user_id = sr.owner_user_id;

COMMENT ON COLUMN messaging_10dlc_registrations.organization_id IS 'Workspace (organizations.id) for this brand/campaign — one row per org.';
