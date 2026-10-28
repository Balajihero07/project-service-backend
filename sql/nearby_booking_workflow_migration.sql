DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM bookings
    WHERE provider_id IS NOT NULL
      AND status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'STARTED')
    GROUP BY provider_id, date_trunc('minute', booking_date)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve active bookings for the same provider and minute before applying the nearby booking migration.';
  END IF;
END $$;

ALTER TABLE bookings
  ALTER COLUMN provider_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_used_at TIMESTAMPTZ;

UPDATE bookings SET otp = NULL WHERE otp IS NOT NULL;

CREATE TABLE IF NOT EXISTS booking_provider_requests (
  request_id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES service_providers(provider_id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'SENT'
    CHECK (status IN ('SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  responded_at TIMESTAMPTZ,
  UNIQUE (booking_id, provider_id)
);

ALTER TABLE booking_provider_requests
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');

CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_provider_status
  ON booking_provider_requests(provider_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_expiry
  ON booking_provider_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_booking_status
  ON booking_provider_requests(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_service_providers_location_updated
  ON service_providers(location_updated_at);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('REQUESTED', 'ACCEPTED', 'REJECTED', 'ON_THE_WAY', 'STARTED', 'COMPLETED', 'CANCELLED'));

ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'REQUESTED';

CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_minute_active_uidx
  ON bookings (provider_id, date_trunc('minute', booking_date))
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'STARTED');
