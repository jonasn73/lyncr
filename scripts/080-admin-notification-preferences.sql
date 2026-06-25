-- Granular platform-admin notification channel toggles (JSONB on users).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS admin_notification_preferences JSONB NOT NULL DEFAULT '{
    "sms_local_job_assignments": true,
    "sms_global_out_of_state_bookings": true,
    "push_live_inbound_ringing": true,
    "push_operator_dispositions": true,
    "email_daily_revenue_digest": true,
    "email_system_fallback_alerts": true
  }'::jsonb;
