-- Tracks Telnyx webhook signature failures so platform admins get paged on a real
-- problem instead of the only record being Vercel's raw runtime logs. One row per
-- distinct alert (currently one per webhook route); event_count/first_event_at reset
-- each time an alert is actually sent, so a burst of failures shows its own size.

CREATE TABLE IF NOT EXISTS webhook_signature_alerts (
  alert_key TEXT PRIMARY KEY,
  event_count INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  last_alerted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
