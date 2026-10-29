const crypto = require('crypto');
const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const { getPlaceDetails } = require('./locationService');

const radiusKm = () => {
  const value = Number(process.env.PROVIDER_SEARCH_RADIUS_KM || 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
};

const freshnessMinutes = () => {
  const value = Number(process.env.PROVIDER_LOCATION_MAX_AGE_MINUTES || 30);
  return Number.isFinite(value) && value > 0 ? value : 30;
};

const otpSecret = () => process.env.OTP_HASH_SECRET || process.env.JWT_SECRET;
const otpHash = (otp) => crypto.createHmac('sha256', otpSecret()).update(otp).digest('hex');
const otpLifetimeMinutes = () => Math.max(1, Number(process.env.OTP_EXPIRE_MINUTES) || 10);
const otpResendSeconds = () => Math.max(1, Number(process.env.OTP_RESEND_SECONDS) || 30);
const otpMaxAttempts = () => Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS) || 5);
const requestExpiryMinutes = () => Math.max(1, Number(process.env.PROVIDER_REQUEST_EXPIRY_MINUTES) || 30);

const BOOKING_SELECT = `
    SELECT b.booking_id, b.customer_id, b.provider_id, b.service_id, b.booking_date,
           b.address, b.latitude, b.longitude, b.status,
          b.service_address, b.service_latitude, b.service_longitude,
          b.service_city, b.service_district,
           b.estimated_amount, b.final_amount, b.created_at, b.updated_at,
           b.accepted_at, b.started_at, b.completed_at, b.otp_expires_at,
           b.otp_attempts, b.otp_used_at,
           s.service_name,
           cu.name AS customer_name, cu.phone AS customer_phone,
           p.user_id AS provider_user_id, pu.name AS provider_name,
           pu.phone AS provider_phone, pu.profile_image AS provider_profile_image,
           p.experience AS provider_experience, p.latitude AS provider_latitude,
           p.longitude AS provider_longitude, p.location_updated_at AS provider_location_updated_at,
           COALESCE((
             SELECT ROUND(AVG(rating)::numeric, 1)
             FROM reviews r WHERE r.provider_id = p.provider_id
           ), 0) AS provider_rating,
           (SELECT COUNT(*) FROM reviews r WHERE r.provider_id = p.provider_id) AS provider_review_count,
           pay.payment_id,
           pay.amount AS payment_amount,
           pay.payment_method,
           COALESCE(pay.payment_status, 'PENDING') AS payment_status,
           pay.paid_at AS payment_paid_at
    FROM bookings b
    JOIN services s ON s.service_id = b.service_id
    JOIN users cu ON cu.user_id = b.customer_id
    LEFT JOIN service_providers p ON p.provider_id = b.provider_id
    LEFT JOIN users pu ON pu.user_id = p.user_id
    LEFT JOIN LATERAL (
      SELECT payment_id, amount, payment_method, payment_status, paid_at FROM payments
      WHERE booking_id = b.booking_id
      ORDER BY payment_id DESC LIMIT 1
    ) pay ON TRUE
`;

const expireProviderRequests = async () => {
  await db`
    UPDATE booking_provider_requests
    SET status = 'EXPIRED', responded_at = NOW()
    WHERE status = 'SENT' AND expires_at <= NOW()
  `;
  await db`
    UPDATE bookings b SET status = 'REJECTED'
    WHERE b.status = 'REQUESTED'
      AND EXISTS (
        SELECT 1 FROM booking_provider_requests r
        WHERE r.booking_id = b.booking_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM booking_provider_requests r
        WHERE r.booking_id = b.booking_id AND r.status = 'SENT'
      )
  `;
};

const loadBooking = async (bookingId, user) => {
  await expireProviderRequests();
  const rows = await db`
    ${db.unsafe(BOOKING_SELECT)}
    WHERE b.booking_id = ${bookingId}
  `;
  const booking = rows[0];
  if (!booking) throw new ApiError(404, 'Booking not found');

  const isAllowedProvider = user.role === 'PROVIDER' &&
    booking.provider_user_id === user.user_id;
  if (user.role !== 'ADMIN' && booking.customer_id !== user.user_id && !isAllowedProvider) {
    throw new ApiError(403, 'Forbidden');
  }
  return booking;
};


const presentBooking = (booking, user) => {
  const result = { ...booking };

  delete result.otp_hash;
  delete result.otp;
  delete result.otp_attempts;

  result.otp_verified = Boolean(result.otp_used_at);

  // Only the customer who owns the booking, an admin,
  // and the provider assigned to the booking can see the
  // customer's phone number.
  const isAssignedProvider =
    user.role === 'PROVIDER' &&
    Number(result.provider_user_id) === Number(user.user_id);

  if (
    user.role !== 'CUSTOMER' &&
    user.role !== 'ADMIN' &&
    !isAssignedProvider
  ) {
    delete result.customer_phone;
  }

  return result;
};


const createBooking = async (data, customerId, bookingType = 'live') => {
  const {
    service_id,
    booking_date,
    address,
    latitude,
    longitude,
    description,
    google_place_id,
    sessionToken,
  } = data;
  const serviceRows = await db`
    SELECT service_id, service_name, base_price
    FROM services
    WHERE service_id = ${service_id} AND is_active = TRUE
  `;
  const service = serviceRows[0];
  if (!service) throw new ApiError(404, 'Service not found or inactive');

  let bookingAddress = typeof address === 'string' ? address.trim() : '';
  if (description !== undefined &&
      (typeof description !== 'string' || description.length > 2000)) {
    throw new ApiError(400, 'Description must be a string of at most 2000 characters.');
  }
  let bookingLatitude = Number(latitude);
  let bookingLongitude = Number(longitude);
  let bookingCity = null;
  let bookingDistrict = null;
  let scheduledAt = new Date();

  if (bookingType === 'google') {
    if (typeof google_place_id !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/.test(google_place_id)) {
      throw new ApiError(400, 'A valid place ID is required.');
    }
    const location = await getPlaceDetails(google_place_id, sessionToken);
    bookingAddress = location.formattedAddress;
    bookingLatitude = location.latitude;
    bookingLongitude = location.longitude;
    bookingCity = location.city;
    bookingDistrict = location.district;
    const date = new Date(booking_date);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new ApiError(400, 'booking_date must be in the future.');
    }
    scheduledAt = date;
  } else if (bookingType === 'date') {
    const date = new Date(booking_date);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      throw new ApiError(400, 'booking_date must be in the future.');
    }
    scheduledAt = date;
  }
  if (typeof bookingAddress !== 'string' || !bookingAddress.trim() || bookingAddress.length > 500) {
    throw new ApiError(400, 'A valid service address is required.');
  }
  if (!Number.isFinite(bookingLatitude) || bookingLatitude < -90 || bookingLatitude > 90 ||
      !Number.isFinite(bookingLongitude) || bookingLongitude < -180 || bookingLongitude > 180) {
    throw new ApiError(400, 'Valid latitude and longitude are required.');
  }

  const rows = await db`
    WITH candidates AS MATERIALIZED (
      SELECT p.provider_id,
        6371 * 2 * ASIN(SQRT(
          LEAST(1, GREATEST(0,
          POWER(SIN(RADIANS(p.latitude::double precision - ${bookingLatitude}) / 2), 2) +
          COS(RADIANS(${bookingLatitude})) * COS(RADIANS(p.latitude::double precision)) *
          POWER(SIN(RADIANS(p.longitude::double precision - ${bookingLongitude}) / 2), 2)
          ))
        )) AS distance_km
      FROM service_providers p
      JOIN users u ON u.user_id = p.user_id
      WHERE p.service_id = ${service_id}
        AND p.verification_status = 'VERIFIED'
        AND p.availability = TRUE
        AND u.is_active = TRUE
        AND u.user_id <> ${customerId}
        AND p.latitude BETWEEN -90 AND 90
        AND p.longitude BETWEEN -180 AND 180
        AND p.location_updated_at >= NOW() - make_interval(mins => ${freshnessMinutes()})
        AND NOT EXISTS (
          SELECT 1 FROM bookings active_booking
          WHERE active_booking.provider_id = p.provider_id
            AND active_booking.status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY', 'STARTED')
            AND date_trunc('minute', active_booking.booking_date) =
                date_trunc('minute', ${scheduledAt}::timestamp)
        )
    ),
    eligible AS MATERIALIZED (
      SELECT provider_id FROM candidates WHERE distance_km <= ${radiusKm()}
    ),
    created AS (
      INSERT INTO bookings (
        customer_id, provider_id, service_id, booking_date, address,
        latitude, longitude, service_address, service_latitude,
        service_longitude, service_city, service_district,
        description, estimated_amount, status
      )
      VALUES (
        ${customerId}, NULL, ${service_id}, ${scheduledAt}, ${bookingAddress},
        ${bookingLatitude}, ${bookingLongitude}, ${bookingAddress},
        ${bookingLatitude}, ${bookingLongitude}, ${bookingCity},
        ${bookingDistrict}, ${description?.trim() || null}, ${service.base_price}, 'REQUESTED'
      )
      RETURNING booking_id
    ),
    sent AS (
      INSERT INTO booking_provider_requests (booking_id, provider_id, expires_at)
      SELECT created.booking_id, eligible.provider_id,
             CASE
               WHEN ${bookingType === 'live'} THEN
                 NOW() + make_interval(mins => ${requestExpiryMinutes()})
               ELSE LEAST(
                 ${scheduledAt}::timestamp,
                 GREATEST(
                   NOW() + make_interval(mins => ${requestExpiryMinutes()}),
                   ${scheduledAt}::timestamp - INTERVAL '30 minutes'
                 )
               )
             END
      FROM created CROSS JOIN eligible
      ON CONFLICT (booking_id, provider_id) DO NOTHING
      RETURNING request_id
    )
    SELECT created.booking_id, (SELECT COUNT(*)::integer FROM sent) AS provider_count
    FROM created
  `;
  if (!rows[0]) throw new ApiError(500, 'Booking could not be created.');
  return {
    booking_id: rows[0].booking_id,
    provider_count: rows[0].provider_count,
    estimated_amount: service.base_price,
    status: 'REQUESTED',
  };
};

const listBookings = async (user) => {
  await expireProviderRequests();
  if (user.role === 'CUSTOMER') {
    return db`
      ${db.unsafe(BOOKING_SELECT)}
      WHERE b.customer_id = ${user.user_id}
      ORDER BY b.created_at DESC
    `;
  }
  if (user.role === 'PROVIDER') {
    return db`
      ${db.unsafe(BOOKING_SELECT)}
      WHERE p.user_id = ${user.user_id}
      ORDER BY b.created_at DESC
    `;
  }
  return db`${db.unsafe(BOOKING_SELECT)} ORDER BY b.created_at DESC`;
};

const listProviderRequests = async (userId) => {
  await expireProviderRequests();
  return db`
    SELECT b.booking_id, b.customer_id, cu.name AS customer_name,
           b.service_id, s.service_name, b.booking_date,
           b.address, b.latitude, b.longitude,
           b.service_address, b.service_latitude, b.service_longitude,
           b.service_city, b.service_district, b.description,
           b.estimated_amount, b.final_amount, b.status AS booking_status,
           b.created_at, b.updated_at,
           r.status AS request_status, r.sent_at, r.expires_at
    FROM booking_provider_requests r
    JOIN service_providers p ON p.provider_id = r.provider_id
    JOIN bookings b ON b.booking_id = r.booking_id
    JOIN services s ON s.service_id = b.service_id
    JOIN users cu ON cu.user_id = b.customer_id
    WHERE p.user_id = ${userId} AND r.status = 'SENT'
      AND r.expires_at > NOW() AND b.status = 'REQUESTED'
    ORDER BY r.sent_at DESC
  `;
};

const listProviderBookings = async (userId, category, options = {}) => {
const statuses = category === 'history'
  ? ['COMPLETED', 'CANCELLED', 'CLOSED']
  : ['ACCEPTED', 'ON_THE_WAY', 'STARTED'];
  const { status = null } = options;
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const offset = (page - 1) * limit;

  if (status && !statuses.includes(status)) {
    throw new ApiError(400, `Status is not valid for provider ${category}.`);
  }

  const statusList = db.unsafe(`(${statuses.map((value) => `'${value}'`).join(', ')})`);
  const [bookings, countRows] = await Promise.all([
    db`
      ${db.unsafe(BOOKING_SELECT)}
      WHERE p.user_id = ${userId} AND b.status IN ${statusList}
        AND (${status}::text IS NULL OR b.status = ${status})
      ORDER BY b.updated_at DESC, b.booking_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    db`
      SELECT COUNT(*)::integer AS total
      FROM bookings b
      JOIN service_providers p ON p.provider_id = b.provider_id
      WHERE p.user_id = ${userId} AND b.status IN ${statusList}
        AND (${status}::text IS NULL OR b.status = ${status})
    `,
  ]);

  const total = countRows[0].total;
  return {
    bookings,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
    },
  };
};

const acceptBooking = async (bookingId, userId) => {
  await expireProviderRequests();
  let rows;
  try {
    rows = await db`
    WITH eligible AS MATERIALIZED (
      SELECT p.provider_id
      FROM service_providers p
      JOIN users u ON u.user_id = p.user_id
      JOIN booking_provider_requests r ON r.provider_id = p.provider_id
      JOIN bookings b ON b.booking_id = r.booking_id
      JOIN services s ON s.service_id = b.service_id AND s.is_active = TRUE
      WHERE r.booking_id = ${bookingId}
        AND r.status = 'SENT'
        AND r.expires_at > NOW()
        AND b.status = 'REQUESTED'
        AND b.provider_id IS NULL
        AND p.user_id = ${userId}
        AND p.verification_status = 'VERIFIED'
        AND p.availability = TRUE
        AND u.is_active = TRUE
        AND p.service_id = b.service_id
        AND p.latitude BETWEEN -90 AND 90
        AND p.longitude BETWEEN -180 AND 180
        AND p.location_updated_at >= NOW() - make_interval(mins => ${freshnessMinutes()})
    ),
    won AS (
      UPDATE bookings b
      SET provider_id = eligible.provider_id,
          status = 'ACCEPTED',
          accepted_at = NOW()
      FROM eligible
      WHERE b.booking_id = ${bookingId}
        AND b.status = 'REQUESTED'
        AND b.provider_id IS NULL
      RETURNING b.booking_id, b.provider_id
    ),
    accepted_request AS (
      UPDATE booking_provider_requests r
      SET status = 'ACCEPTED', responded_at = NOW()
      FROM won
      WHERE r.booking_id = won.booking_id AND r.provider_id = won.provider_id
      RETURNING r.request_id
    ),
    closed_requests AS (
      UPDATE booking_provider_requests r
      SET status = 'EXPIRED', responded_at = NOW()
      FROM won
      WHERE r.booking_id = won.booking_id
        AND r.provider_id <> won.provider_id
        AND r.status = 'SENT'
      RETURNING r.request_id
    )
    SELECT booking_id FROM won
    `;
  } catch (error) {
    if (error?.code === '23505' &&
        error?.constraint === 'bookings_provider_minute_active_uidx') {
      await rejectBooking(bookingId, userId);
      throw new ApiError(409, 'The provider already has a booking in that time slot.');
    }
    throw error;
  }
  if (!rows[0]) {
    const ownRequest = await db`
      SELECT r.status AS request_status, b.status AS booking_status
      FROM booking_provider_requests r
      JOIN service_providers p ON p.provider_id = r.provider_id
      JOIN bookings b ON b.booking_id = r.booking_id
      WHERE r.booking_id = ${bookingId} AND p.user_id = ${userId}
    `;
    if (!ownRequest[0]) throw new ApiError(404, 'Booking request not found');
    throw new ApiError(409, 'This booking has already been accepted or is no longer available.');
  }
  return rows[0].booking_id;
};

const rejectBooking = async (bookingId, userId) => {
  await expireProviderRequests();
  const [lockedRows, rows] = await db.transaction((tx) => [
    tx`
      SELECT booking_id FROM bookings
      WHERE booking_id = ${bookingId}
      FOR UPDATE
    `,
    tx`
      UPDATE booking_provider_requests r
      SET status = 'REJECTED', responded_at = NOW()
      FROM service_providers p, bookings b
      WHERE r.booking_id = ${bookingId}
        AND r.provider_id = p.provider_id
        AND p.user_id = ${userId}
        AND r.status = 'SENT'
        AND r.expires_at > NOW()
        AND b.booking_id = r.booking_id
        AND b.status = 'REQUESTED'
      RETURNING r.booking_id
    `,
    tx`
      UPDATE bookings b SET status = 'REJECTED'
      WHERE b.booking_id = ${bookingId}
        AND b.status = 'REQUESTED'
        AND EXISTS (
          SELECT 1 FROM booking_provider_requests r
          JOIN service_providers p ON p.provider_id = r.provider_id
          WHERE r.booking_id = b.booking_id
            AND r.status = 'REJECTED'
            AND p.user_id = ${userId}
        )
        AND NOT EXISTS (
          SELECT 1 FROM booking_provider_requests r
          WHERE r.booking_id = b.booking_id AND r.status = 'SENT'
        )
    `,
  ]);
  if (!lockedRows[0] || !rows[0]) {
    const exists = await db`
      SELECT 1 FROM booking_provider_requests r
      JOIN service_providers p ON p.provider_id = r.provider_id
      WHERE r.booking_id = ${bookingId} AND p.user_id = ${userId}
    `;
    if (!exists[0]) throw new ApiError(404, 'Booking request not found');
    throw new ApiError(409, 'This booking request is no longer available.');
  }
};

const generateCustomerOtp = async (bookingId, userId) => {
  const otp = String(crypto.randomInt(100000, 1000000));
  const rows = await db`
    UPDATE bookings b
    SET otp_hash = ${otpHash(otp)},
        otp_expires_at = NOW() + make_interval(mins => ${otpLifetimeMinutes()}),
        otp_attempts = 0,
        otp_generated_at = NOW(),
        otp_used_at = NULL
    WHERE b.booking_id = ${bookingId}
      AND b.customer_id = ${userId}
      AND b.status IN ('ACCEPTED', 'ON_THE_WAY')
      AND (b.otp_generated_at IS NULL OR b.otp_generated_at <=
        NOW() - make_interval(secs => ${otpResendSeconds()}))
    RETURNING booking_id, otp_expires_at
  `;
  if (!rows[0]) {
    const bookingRows = await db`
      SELECT status, otp_generated_at, otp_attempts
      FROM bookings WHERE booking_id = ${bookingId} AND customer_id = ${userId}
    `;
    if (!bookingRows[0]) throw new ApiError(404, 'Booking not found');
    if (!['ACCEPTED', 'ON_THE_WAY'].includes(bookingRows[0].status)) {
      throw new ApiError(400, 'OTP is available only after provider acceptance.');
    }
    if (bookingRows[0].otp_attempts >= otpMaxAttempts()) throw new ApiError(429, 'OTP attempt limit reached.');
    throw new ApiError(429, 'Please wait before requesting another OTP.');
  }
  return { booking_id: rows[0].booking_id, otp, expires_at: rows[0].otp_expires_at };
};

const verifyBookingOtp = async (bookingId, userId, enteredOtp) => {
  const rows = await db`
    UPDATE bookings b
    SET status = CASE WHEN b.otp_hash = ${otpHash(enteredOtp)} THEN 'STARTED' ELSE b.status END,
        otp_attempts = b.otp_attempts + CASE WHEN b.otp_hash = ${otpHash(enteredOtp)} THEN 0 ELSE 1 END,
        otp_used_at = CASE WHEN b.otp_hash = ${otpHash(enteredOtp)} THEN NOW() ELSE b.otp_used_at END,
        started_at = CASE WHEN b.otp_hash = ${otpHash(enteredOtp)} THEN NOW() ELSE b.started_at END
    FROM service_providers p
    WHERE b.booking_id = ${bookingId}
      AND b.provider_id = p.provider_id
      AND p.user_id = ${userId}
      AND b.status IN ('ACCEPTED', 'ON_THE_WAY')
      AND b.otp_hash IS NOT NULL
      AND b.otp_used_at IS NULL
      AND b.otp_expires_at > NOW()
      AND b.otp_attempts < ${otpMaxAttempts()}
    RETURNING b.status, b.otp_attempts
  `;
  if (!rows[0]) {
    const state = await db`
      SELECT b.status, b.otp_expires_at, b.otp_attempts, b.otp_used_at,
             p.user_id AS provider_user_id
      FROM bookings b LEFT JOIN service_providers p ON p.provider_id = b.provider_id
      WHERE b.booking_id = ${bookingId}
    `;
    const booking = state[0];
    if (!booking) throw new ApiError(404, 'Booking not found');
    if (booking.provider_user_id !== userId) throw new ApiError(403, 'Only the assigned provider can verify this OTP.');
    if (!['ACCEPTED', 'ON_THE_WAY'].includes(booking.status)) {
      throw new ApiError(400, 'Booking is not awaiting OTP verification.');
    }
    if (booking.otp_used_at) throw new ApiError(409, 'OTP has already been used.');
    if (booking.otp_attempts >= otpMaxAttempts()) throw new ApiError(429, 'OTP attempt limit reached.');
    throw new ApiError(400, 'OTP is missing or expired.');
  }
  if (rows[0].status !== 'STARTED') {
    if (rows[0].otp_attempts >= otpMaxAttempts()) throw new ApiError(429, 'OTP attempt limit reached.');
    throw new ApiError(400, 'Invalid OTP');
  }
};

const updateBookingStatus = async (bookingId, user, status) => {
  const allowed = status === 'ON_THE_WAY'
    ? ['ACCEPTED']
    : status === 'CANCELLED'
      ? ['REQUESTED', 'ACCEPTED', 'ON_THE_WAY']
      : status === 'COMPLETED'
        ? ['STARTED']
        : [];
  if (!allowed.length) throw new ApiError(400, 'Invalid transition');
  const rows = await db`
    WITH changed AS (
    UPDATE bookings b
    SET status = ${status},
        otp_hash = CASE WHEN ${status} = 'CANCELLED' THEN NULL ELSE otp_hash END,
        otp_expires_at = CASE WHEN ${status} = 'CANCELLED' THEN NULL ELSE otp_expires_at END,
        completed_at = CASE WHEN ${status} = 'COMPLETED' THEN NOW() ELSE completed_at END,
        final_amount = CASE WHEN ${status} = 'COMPLETED' THEN estimated_amount ELSE final_amount END
    WHERE b.booking_id = ${bookingId}
      AND (
        (${status} = 'ON_THE_WAY' AND b.status = 'ACCEPTED')
        OR (${status} = 'CANCELLED' AND b.status IN ('REQUESTED', 'ACCEPTED', 'ON_THE_WAY'))
        OR (${status} = 'COMPLETED' AND b.status = 'STARTED')
      )
      AND (${status} <> 'COMPLETED' OR (b.otp_used_at IS NOT NULL AND b.started_at IS NOT NULL))
      AND (
        (${user.role} = 'CUSTOMER' AND b.customer_id = ${user.user_id} AND ${status} = 'CANCELLED')
        OR (${user.role} = 'PROVIDER' AND EXISTS (
          SELECT 1 FROM service_providers p
          WHERE p.provider_id = b.provider_id AND p.user_id = ${user.user_id}
        ) AND ${status} IN ('ON_THE_WAY', 'COMPLETED', 'CANCELLED'))
        OR (${user.role} = 'ADMIN' AND ${status} = 'CANCELLED')
      )
    RETURNING booking_id
    ),
    closed_requests AS (
      UPDATE booking_provider_requests r
      SET status = 'CANCELLED', responded_at = NOW()
      FROM changed
      WHERE r.booking_id = changed.booking_id
        AND r.status = 'SENT'
        AND ${status} = 'CANCELLED'
      RETURNING r.request_id
    )
    SELECT booking_id FROM changed
  `;
  if (!rows[0]) throw new ApiError(409, 'Booking status cannot be changed by this user.');
};

module.exports = {
  presentBooking,
  loadBooking,
  createBooking,
  listBookings,
  listProviderRequests,
  listProviderBookings,
  acceptBooking,
  rejectBooking,
  generateCustomerOtp,
  verifyBookingOtp,
  updateBookingStatus,
};
