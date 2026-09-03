-- 163: Tie key_inventory_ledger rows to the job that consumed the key.
-- Run in Neon SQL Editor after 162-tech-job-acceptance.sql.
--
-- The ledger (160) could already tell you what moved and who moved it, but never why a key
-- left the van — a scan-adjust and "pulled a key for a job" looked identical. This adds a
-- job_id (nullable — most ledger rows still aren't job-related) and a new 'job_use' reason
-- so a tech closing out a job can log which key he used and have it auto-deduct, distinct
-- from a plain inventory recount.
--
-- Safe to run multiple times.

ALTER TABLE key_inventory_ledger
  ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES ai_leads(id) ON DELETE SET NULL;

ALTER TABLE key_inventory_ledger
  DROP CONSTRAINT IF EXISTS key_inventory_ledger_reason_check;

ALTER TABLE key_inventory_ledger
  ADD CONSTRAINT key_inventory_ledger_reason_check
  CHECK (reason IN ('scan_adjust', 'new_sku_initial', 'reorder_received', 'job_use'));

CREATE INDEX IF NOT EXISTS key_inventory_ledger_job_idx
  ON key_inventory_ledger (job_id)
  WHERE job_id IS NOT NULL;

COMMENT ON COLUMN key_inventory_ledger.job_id IS
  'Set when reason = job_use — the job this key was pulled for. Null for scan/reorder/initial-stock rows.';
