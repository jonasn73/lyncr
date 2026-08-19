-- Signup approval (scripts/MIGRATE-ALL.md step 139).
-- No new column. New shops store pending or denied in onboarding_profiles.account_status (added in 034).
-- Existing shops stay Active. Safe to re-run.

SELECT 1;
