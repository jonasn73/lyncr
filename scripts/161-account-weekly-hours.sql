-- Weekly recurring available hours — auto-flip Presence without a manual tap.
-- Owner sets a schedule once; sync-presence cron (5 min) applies AVAILABLE/CLOSED
-- from it the same way it already applies ON_JOB from calendar blockouts.

ALTER TABLE account_settings
  ADD COLUMN IF NOT EXISTS hours_schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hours_timezone TEXT NOT NULL DEFAULT 'America/New_York';

CREATE TABLE IF NOT EXISTS account_weekly_hours (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday
  enabled BOOLEAN NOT NULL DEFAULT true,
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '17:00',
  PRIMARY KEY (user_id, day_of_week)
);
