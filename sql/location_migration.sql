ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS district VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT 'Tamil Nadu',
  ADD COLUMN IF NOT EXISTS google_place_id TEXT,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS service_address TEXT,
  ADD COLUMN IF NOT EXISTS service_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS service_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS service_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS service_district VARCHAR(100);

UPDATE bookings
SET service_address = COALESCE(address, '')
WHERE service_address IS NULL;

ALTER TABLE bookings
  ALTER COLUMN service_address SET NOT NULL;

ALTER TABLE service_providers
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

UPDATE service_providers p
SET service_id = s.service_id
FROM services s
WHERE p.service_id IS NULL
  AND s.is_active = TRUE
  AND LOWER(TRIM(SPLIT_PART(p.skill, ',', 1))) = LOWER(s.service_name);

ALTER TABLE service_providers
  ALTER COLUMN availability SET DEFAULT FALSE;

UPDATE service_providers
SET availability = FALSE
WHERE availability = TRUE
  AND (
    latitude IS NULL
    OR longitude IS NULL
    OR verification_status <> 'VERIFIED'
  );
