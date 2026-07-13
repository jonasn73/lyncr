-- Pending Info Intake rescue: profile fields + photo categories + info_received status.

ALTER TABLE job_photo_tokens
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_vin TEXT,
  ADD COLUMN IF NOT EXISTS special_notes TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_year TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_make TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_trim TEXT,
  ADD COLUMN IF NOT EXISTS rescue_submitted_at TIMESTAMPTZ;

ALTER TABLE job_photo_tokens
  DROP CONSTRAINT IF EXISTS job_photo_tokens_ticket_status_check;

ALTER TABLE job_photo_tokens
  ADD CONSTRAINT job_photo_tokens_ticket_status_check
  CHECK (ticket_status IN (
    'awaiting_photos',
    'pending_info',
    'info_received',
    'resolved'
  ));

ALTER TABLE job_photos
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'damage';

ALTER TABLE job_photos
  DROP CONSTRAINT IF EXISTS job_photos_category_check;

ALTER TABLE job_photos
  ADD CONSTRAINT job_photos_category_check
  CHECK (category IN ('damage', 'id_verification', 'other'));

COMMENT ON COLUMN job_photo_tokens.ticket_status IS
  'awaiting_photos / pending_info → waiting; info_received → customer completed /intake-rescue.';
COMMENT ON COLUMN job_photos.category IS
  'damage = lock/ignition photos; id_verification = DL/registration; other = misc.';
