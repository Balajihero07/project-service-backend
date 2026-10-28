-- Project Service schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS users (
  user_id        SERIAL PRIMARY KEY,
  name           VARCHAR(100) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  phone          VARCHAR(15)  NOT NULL,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER'
                 CHECK (role IN ('CUSTOMER','PROVIDER','ADMIN')),
  profile_image  TEXT,
  address        TEXT,
  latitude       DECIMAL(10,7),
  longitude      DECIMAL(10,7),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
  service_id    SERIAL PRIMARY KEY,
  service_name  VARCHAR(100) NOT NULL UNIQUE,
  description   TEXT,
  category      VARCHAR(100),
  base_price    DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_providers (
  provider_id          SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  service_id           INTEGER REFERENCES services(service_id),
  skill                VARCHAR(100),
  experience           INTEGER NOT NULL DEFAULT 0 CHECK (experience >= 0),
  verification_status  VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                       CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED')),
  id_proof             TEXT,
  id_proof_name        VARCHAR(150),
  live_photo           TEXT,
  state                VARCHAR(100),
  district             VARCHAR(100),
  city                 VARCHAR(100),
  pincode              VARCHAR(10),
  address              TEXT,
  latitude             DECIMAL(10,7),
  longitude            DECIMAL(10,7),
  availability         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMP NOT NULL DEFAULT NOW(),
  location_updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS bookings (
  booking_id        SERIAL PRIMARY KEY,
  customer_id       INTEGER NOT NULL REFERENCES users(user_id),
  provider_id       INTEGER REFERENCES service_providers(provider_id),
  service_id        INTEGER NOT NULL REFERENCES services(service_id),
  booking_date      TIMESTAMP NOT NULL,
  description       TEXT,
  address           TEXT NOT NULL,
  latitude          DECIMAL(10,7),
  longitude         DECIMAL(10,7),
  service_address   TEXT NOT NULL,
  service_latitude  DOUBLE PRECISION,
  service_longitude DOUBLE PRECISION,
  service_city      VARCHAR(100),
  service_district  VARCHAR(100),
  status            VARCHAR(30) NOT NULL DEFAULT 'REQUESTED'
                    CHECK (status IN ('REQUESTED','ACCEPTED','REJECTED','ON_THE_WAY','STARTED','COMPLETED','CANCELLED')),
  otp_hash          TEXT,
  otp_expires_at    TIMESTAMPTZ,
  otp_attempts      INTEGER NOT NULL DEFAULT 0,
  otp_generated_at  TIMESTAMPTZ,
  otp_used_at       TIMESTAMPTZ,
  estimated_amount  DECIMAL(10,2),
  final_amount      DECIMAL(10,2),
  accepted_at       TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS payments (
  payment_id      SERIAL PRIMARY KEY,
  booking_id      INTEGER NOT NULL REFERENCES bookings(booking_id),
  amount          DECIMAL(10,2) NOT NULL,
  payment_method  VARCHAR(50) NOT NULL CHECK (payment_method IN ('QR','ONLINE','WALLET','CASH')),
  transaction_id  VARCHAR(150),
  payment_status  VARCHAR(30) NOT NULL DEFAULT 'PENDING'
                  CHECK (payment_status IN ('PENDING','SUCCESS','FAILED','REFUNDED')),
  paid_at         TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id    SERIAL PRIMARY KEY,
  booking_id   INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id),
  customer_id  INTEGER NOT NULL REFERENCES users(user_id),
  provider_id  INTEGER NOT NULL REFERENCES service_providers(provider_id),
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_providers_service ON service_providers(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status   ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_provider_status
  ON booking_provider_requests(provider_id, status, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_expiry
  ON booking_provider_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_provider_requests_booking_status
  ON booking_provider_requests(booking_id, status);
CREATE INDEX IF NOT EXISTS idx_service_providers_location_updated
  ON service_providers(location_updated_at);
CREATE INDEX IF NOT EXISTS idx_payments_booking  ON payments(booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_open_per_booking_uidx
  ON payments(booking_id)
  WHERE payment_status IN ('PENDING', 'SUCCESS');
CREATE INDEX IF NOT EXISTS idx_reviews_provider  ON reviews(provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_provider_minute_active_uidx
  ON bookings (provider_id, date_trunc('minute', booking_date))
  WHERE status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'STARTED');

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
DROP TRIGGER IF EXISTS trg_bookings_updated ON bookings;
CREATE TRIGGER trg_bookings_updated BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO services (service_name, description, category, base_price) VALUES
 ('Electrician','Wiring, fittings, repairs','Electrical',300),
 ('Plumber','Leaks, pipes, taps, fittings','Plumbing',300),
 ('Carpenter','Furniture and woodwork','Woodwork',400),
 ('Painter','Interior and exterior painting','Painting',500),
 ('Welder','Metal fabrication and repair','Metalwork',500),
 ('Mason','Construction and repair','Construction',600)
ON CONFLICT (service_name) DO NOTHING;
