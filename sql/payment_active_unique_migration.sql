-- Prevent concurrent duplicate pending/successful payments for one booking.
DO $$
BEGIN
  IF EXISTS (
    SELECT booking_id
    FROM payments
    WHERE payment_status IN ('PENDING', 'SUCCESS')
    GROUP BY booking_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Resolve duplicate pending/successful payments before applying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_booking_uidx
  ON payments(booking_id)
  WHERE payment_status IN ('PENDING', 'SUCCESS');