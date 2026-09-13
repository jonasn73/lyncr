-- Wallet/Collect shop scoping — Neon migration 171
-- Run in Neon → SQL Editor after deploy. Agents cannot apply this for you.
-- Walk-up Collect charges (no linked job) had no way to attribute which shop they
-- belonged to, so CRM's lifetime-revenue total summed them across every shop an owner
-- has. Both nullable — existing rows and any pre-migration write path keep working
-- unscoped (counts everywhere), same fallback used throughout the org-scoping work.

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS organization_id uuid;

ALTER TABLE collect_pay_links
  ADD COLUMN IF NOT EXISTS organization_id uuid;

COMMENT ON COLUMN wallet_transactions.organization_id IS
  'Shop this charge belongs to, when known — null means unattributed (counts for every shop).';

COMMENT ON COLUMN collect_pay_links.organization_id IS
  'Shop this pay link was created from, when known — carried into the Stripe Checkout session metadata so the fulfillment webhook can stamp wallet_transactions.organization_id.';
