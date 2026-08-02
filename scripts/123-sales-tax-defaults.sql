-- 123: Default sales tax for Collect / Charge (on by default at 6%).
-- Run in Neon SQL Editor after 122-sms-latest-attention.sql.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS sales_tax_enabled_default BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS sales_tax_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 6.00;

COMMENT ON COLUMN account_settings.sales_tax_enabled_default IS
  'When true, Collect/Charge opens with Add sales tax ON (owner can still toggle per charge).';
COMMENT ON COLUMN account_settings.sales_tax_rate_percent IS
  'Default sales tax percent (e.g. 6.00 for 6%). Used when sales_tax_enabled_default is true.';
