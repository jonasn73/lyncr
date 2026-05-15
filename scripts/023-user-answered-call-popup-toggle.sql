-- ============================================
-- 023 — Toggle for answered-call customer capture sheet
-- ============================================
-- When false, the dashboard does not poll or open the post-answer CRM sheet.
-- Default true preserves current behavior for existing accounts.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS answered_call_customer_popup_enabled BOOLEAN NOT NULL DEFAULT true;
