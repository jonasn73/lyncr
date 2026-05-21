-- Precomputed inbound dial target on each DID — one indexed row read on Telnyx webhooks (no routing joins).
-- Run in Neon SQL Editor (see scripts/MIGRATE-ALL.md step 36).
-- After running: open the Routing tab once in the dashboard to backfill snapshots.

ALTER TABLE phone_numbers
  ADD COLUMN IF NOT EXISTS inbound_dial_e164 text,
  ADD COLUMN IF NOT EXISTS inbound_receptionist_id uuid,
  ADD COLUMN IF NOT EXISTS inbound_receptionist_name text,
  ADD COLUMN IF NOT EXISTS inbound_fallback_type text,
  ADD COLUMN IF NOT EXISTS inbound_ring_timeout_seconds integer,
  ADD COLUMN IF NOT EXISTS inbound_account_status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS inbound_ai_ring_owner_first boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS inbound_routing_updated_at timestamptz;
