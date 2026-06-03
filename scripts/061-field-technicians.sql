-- 061: Field Technician Console + Owner Dispatch engine.
-- Run in Neon SQL Editor after 060-voice-wrapup.sql.
--
-- Adds a third login role (field_tech), a roster table linking techs to their owner, job-assignment
-- + job-status columns on ai_leads, a job_invoices table for the in-field invoicing flow, and a
-- lightweight owner merchant-config flag on onboarding_profiles.

-- 1) Allow the new account_role value. The old CHECK only permitted owner/receptionist.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_account_role_check
  CHECK (account_role IN ('owner', 'receptionist', 'field_tech'));

-- 2) Technician roster: one row per tech, linking the owner to the tech's login user.
CREATE TABLE IF NOT EXISTS field_technicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,         -- the business OWNER
  portal_user_id UUID REFERENCES users(id) ON DELETE SET NULL,          -- the tech's LOGIN user (account_role=field_tech)
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portal_user_id)
);
CREATE INDEX IF NOT EXISTS field_technicians_owner_idx ON field_technicians (user_id, is_active);

-- 3) Job assignment + field status live on the existing ai_leads (booked jobs) rows.
ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS assigned_tech_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_status TEXT;  -- assigned | en_route | arrived | completed
CREATE INDEX IF NOT EXISTS ai_leads_assigned_tech_idx ON ai_leads (assigned_tech_id, created_at DESC);

COMMENT ON COLUMN ai_leads.assigned_tech_id IS 'users.id of the field_tech this job is dispatched to.';
COMMENT ON COLUMN ai_leads.job_status IS 'Field progress: assigned | en_route | arrived | completed.';

-- 4) Invoices raised by a tech on-site.
CREATE TABLE IF NOT EXISTS job_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES ai_leads(id) ON DELETE SET NULL,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tech_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_phone TEXT,
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ label, amount_cents }]
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid | pending | paid | recorded
  payment_method TEXT,                            -- card | cash | none
  card_last4 TEXT,                                -- last 4 only — never store full PAN
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS job_invoices_owner_idx ON job_invoices (owner_user_id, created_at DESC);

-- 5) Owner merchant-config flag (the tech invoice "Collect Payment" uses the owner's processor).
--    Secret API keys belong in a secrets manager — this only tracks provider + a "configured" flag.
ALTER TABLE onboarding_profiles
  ADD COLUMN IF NOT EXISTS merchant_provider TEXT,
  ADD COLUMN IF NOT EXISTS merchant_account_label TEXT,
  ADD COLUMN IF NOT EXISTS merchant_configured BOOLEAN NOT NULL DEFAULT false;
