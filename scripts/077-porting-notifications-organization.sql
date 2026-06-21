-- ============================================
-- Porting notifications — workspace (organization) scope
-- ============================================
-- Ensures Telnyx porting webhook alerts (PIN exceptions, etc.) stay tied to the
-- correct workspace (e.g. Key Squad 502 vs other orgs under the same owner).

ALTER TABLE porting_notifications
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_porting_notifications_user_org_created
  ON porting_notifications (user_id, organization_id, created_at DESC);
