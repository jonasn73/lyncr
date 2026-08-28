-- Owner-configurable per-tech capability flags (mirrors 150-receptionist-capabilities.sql).
--
-- Off by default, so no existing tech changes behaviour until an owner grants something.

ALTER TABLE field_technicians
  ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '{
    "job_pool": false,
    "customer_contact": false,
    "collect_payment": false,
    "view_earnings": false
  }'::jsonb;
