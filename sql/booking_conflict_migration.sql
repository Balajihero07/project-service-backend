CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_minute_active_uidx
  ON bookings (provider_id, date_trunc('minute', booking_date))
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'STARTED');
