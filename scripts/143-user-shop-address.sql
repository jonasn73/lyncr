-- 143: Shop address — the origin travel distance is measured from.
--
-- Before this, dispatch-live-map fell back to DEFAULT_502_SERVICE_BIAS (a fixed
-- Louisville metro centroid meant for geocoder autocomplete bias) whenever GPS was
-- unavailable, while the intake banner labelled the result "shop baseline". Any shop
-- not literally at 38.2527/-85.7585 saw a wrong distance and ETA presented as if it
-- had been measured from their own address.
--
-- Coordinates are stored alongside the text so the map never has to re-geocode.
--
-- Safe to run multiple times.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shop_address TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shop_latitude DOUBLE PRECISION;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS shop_longitude DOUBLE PRECISION;

COMMENT ON COLUMN users.shop_address IS
  'Formatted shop / home-base address — origin for intake travel distance when GPS is off.';
COMMENT ON COLUMN users.shop_latitude IS
  'Geocoded shop latitude, captured when the address was picked (no re-geocode at render).';
COMMENT ON COLUMN users.shop_longitude IS
  'Geocoded shop longitude, captured when the address was picked (no re-geocode at render).';
