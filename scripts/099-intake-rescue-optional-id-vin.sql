-- Optional ID-on-arrival + VIN-unavailable flags for Pending Info Intake.

ALTER TABLE job_photo_tokens
  ADD COLUMN IF NOT EXISTS verify_on_arrival BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE job_photo_tokens
  ADD COLUMN IF NOT EXISTS vin_unavailable BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN job_photo_tokens.verify_on_arrival IS
  'Customer will present physical ID to the tech on arrival (no ID photo uploaded).';
COMMENT ON COLUMN job_photo_tokens.vin_unavailable IS
  'Vehicle locked / customer cannot access VIN — used manual Year/Make/Model instead.';
