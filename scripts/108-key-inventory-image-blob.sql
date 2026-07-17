-- Key Inventory — store captured key photos (base64) for Quick Photo Upload.
-- image_url points at /api/inventory/{id}/image for display. Run after 107.

ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS image_data_base64 TEXT;

ALTER TABLE key_inventory
  ADD COLUMN IF NOT EXISTS image_mime_type TEXT;

COMMENT ON COLUMN key_inventory.image_data_base64 IS
  'Raw base64 (no data: prefix) for operator-captured key photo.';
COMMENT ON COLUMN key_inventory.image_mime_type IS
  'MIME type for image_data_base64 (e.g. image/jpeg).';
