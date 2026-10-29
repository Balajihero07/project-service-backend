const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { uploadBuffer } = require('../config/cloudinary');
const { getPlaceDetails } = require('../services/locationService');

const locationFreshnessMinutes = () => {
  const configured = Number(process.env.PROVIDER_LOCATION_MAX_AGE_MINUTES || 30);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
};

const BASE = `
  SELECT p.provider_id, p.user_id, u.name, u.phone, u.profile_image, p.service_id, s.service_name,
         p.skill, p.experience, p.verification_status, p.availability,
         COALESCE(p.latitude, u.latitude) AS latitude,
         COALESCE(p.longitude, u.longitude) AS longitude,
         p.location_updated_at,
         COALESCE((SELECT ROUND(AVG(rating)::numeric,1) FROM reviews r WHERE r.provider_id=p.provider_id),0) AS avg_rating,
         (SELECT COUNT(*) FROM reviews r WHERE r.provider_id=p.provider_id) AS review_count
  FROM service_providers p
  JOIN users u ON u.user_id = p.user_id
  LEFT JOIN services s ON s.service_id = p.service_id`;

// GET /api/providers?service_id=&lat=&lng=&radius=10
// Public discovery: only verified, available, active providers. Sorted by distance if lat/lng given.
exports.list = asyncHandler(async (req, res) => {
  const { service_id } = req.query;
  const defaultRadius = Number(process.env.PROVIDER_SEARCH_RADIUS_KM || 10);
  const radius = req.query.radius || (Number.isFinite(defaultRadius) && defaultRadius > 0
    ? defaultRadius
    : 10);
  const lat = req.query.lat ?? req.providerLocation?.latitude;
  const lng = req.query.lng ?? req.providerLocation?.longitude;
  const serviceId = service_id || null;
  if (lat !== undefined && lng !== undefined) {
    const latitude = Number(lat);
    const longitude = Number(lng);
    const radiusKm = Number(radius);
    const rows = await db`
      SELECT * FROM (
        SELECT
          t.*,
          6371 * acos(GREATEST(-1, LEAST(1,
            cos(radians(${latitude})) *
            cos(radians(t.latitude)) *
            cos(radians(t.longitude) - radians(${longitude})) +
            sin(radians(${latitude})) * sin(radians(t.latitude))
          ))) AS distance_km
        FROM (${db.unsafe(BASE)}) t
        WHERE t.latitude IS NOT NULL
          AND t.longitude IS NOT NULL
          AND t.latitude BETWEEN -90 AND 90
          AND t.longitude BETWEEN -180 AND 180
          AND t.service_id IS NOT NULL
          AND t.verification_status = 'VERIFIED'
          AND t.availability = TRUE
          AND t.location_updated_at >= NOW() - make_interval(mins => ${locationFreshnessMinutes()})
          AND EXISTS (
            SELECT 1 FROM services active_service
            WHERE active_service.service_id = t.service_id
              AND active_service.is_active = TRUE
          )
          AND EXISTS (
            SELECT 1 FROM users active_user
            WHERE active_user.user_id = t.user_id
              AND active_user.is_active = TRUE
          )
          AND ((${serviceId}::integer IS NULL) OR t.service_id = ${serviceId})
      ) d
      WHERE d.distance_km <= ${radiusKm}
      ORDER BY d.distance_km
    `;
    return ok(
      res,
      rows.length ? 'Providers fetched' : 'No available providers found nearby.',
      rows
    );
  }

  const rows = await db`
    ${db.unsafe(BASE)}
    WHERE p.verification_status = 'VERIFIED'
      AND p.availability = TRUE
      AND p.location_updated_at >= NOW() - make_interval(mins => ${locationFreshnessMinutes()})
      AND p.service_id IS NOT NULL
      AND s.is_active = TRUE
      AND u.is_active = TRUE
      AND ((${serviceId}::integer IS NULL) OR p.service_id = ${serviceId})
    ORDER BY avg_rating DESC
  `;
  ok(res, rows.length ? 'Providers fetched' : 'No available providers found.', rows);
});

// GET /api/providers/getservice_provider
exports.listForUser = asyncHandler(async (req, res) => {
  const hasQueryCoordinates = req.query.lat !== undefined && req.query.lng !== undefined;
  if (!hasQueryCoordinates) {
    const rows = await db`
      SELECT latitude, longitude
      FROM users
      WHERE user_id = ${req.user.user_id}
    `;
    const user = rows[0];
    if (user?.latitude !== null && user?.latitude !== undefined &&
        user?.longitude !== null && user?.longitude !== undefined) {
      req.providerLocation = user;
    }
  }
  return exports.list(req, res);
});

// POST /api/providers/nearby_service
exports.updateLocationAvailability = asyncHandler(async (req, res) => {
  const providerRows = await db`
    SELECT provider_id, verification_status
    FROM service_providers
    WHERE user_id = ${req.user.user_id}
  `;
  const provider = providerRows[0];
  if (!provider) throw new ApiError(404, 'Provider not found');
  if (req.body.availability && provider.verification_status !== 'VERIFIED') {
    throw new ApiError(403, 'Only verified providers can go online.');
  }
  if (req.body.availability && (
    req.body.latitude === undefined ||
    req.body.longitude === undefined
  )) {
    throw new ApiError(400, 'Coordinates are required to go online.');
  }

  const rows = await db`
    UPDATE service_providers
    SET availability = ${req.body.availability},
        latitude = COALESCE(${req.body.latitude ?? null}, latitude),
        longitude = COALESCE(${req.body.longitude ?? null}, longitude),
        location_updated_at = CASE
          WHEN ${req.body.latitude ?? null}::double precision IS NOT NULL THEN NOW()
          ELSE location_updated_at
        END
    WHERE provider_id = ${provider.provider_id}
      AND user_id = ${req.user.user_id}
      AND (${req.body.availability} = FALSE OR verification_status = 'VERIFIED')
    RETURNING provider_id, user_id, availability, latitude, longitude,
              location_updated_at, verification_status
  `;
  if (!rows[0]) {
    throw new ApiError(403, 'Only verified providers can go online.');
  }
  ok(res, 'Provider availability and location updated', rows[0]);
});

exports.updateOwnLocation = asyncHandler(async (req, res) => {
  const rows = await db`
    UPDATE service_providers
    SET latitude = ${Number(req.body.latitude)},
        longitude = ${Number(req.body.longitude)},
        location_updated_at = NOW()
    WHERE user_id = ${req.user.user_id}
    RETURNING provider_id, latitude, longitude, location_updated_at, availability
  `;
  if (!rows[0]) throw new ApiError(404, 'Provider not found');
  ok(res, 'Provider location updated', rows[0]);
});

// POST /api/providers/register (multipart: id_proof, live_photo)
exports.register = asyncHandler(async (req, res) => {
  const userId = Number(req.body.user_id);
  if (userId !== req.user.user_id) {
    throw new ApiError(403, 'You can only register your own provider profile.');
  }

  const serviceRows = await db`
    SELECT service_id
    FROM services
    WHERE service_id = ${req.body.service_id}
      AND is_active = TRUE
  `;
  if (!serviceRows[0]) throw new ApiError(400, 'Select an active service.');

  const idProofFile = req.files?.id_proof?.[0];
  const livePhotoFile = req.files?.live_photo?.[0];
  if (!idProofFile || !livePhotoFile) {
    throw new ApiError(400, 'Both id_proof and live_photo images are required.');
  }

  const [idProof, livePhoto] = await Promise.all([
    uploadBuffer(idProofFile.buffer, 'id-proofs'),
    uploadBuffer(livePhotoFile.buffer, 'live-photos'),
  ]);

  const rows = await db`
    INSERT INTO service_providers (
      user_id,
      service_id,
      skill,
      experience,
      id_proof,
      live_photo,
      state,
      district,
      pincode,
      id_proof_name,
      address,
      verification_status,
      availability
    )
    VALUES (
      ${userId},
      ${Number(req.body.service_id)},
      ${req.body.skill},
      ${Number(req.body.experience)},
      ${idProof},
      ${livePhoto},
      ${req.body.state},
      ${req.body.district},
      ${req.body.pincode},
      ${req.body.id_proof_name},
      ${req.body.address},
      'PENDING',
      FALSE
    )
    ON CONFLICT (user_id) DO UPDATE SET
      service_id = EXCLUDED.service_id,
      skill = EXCLUDED.skill,
      experience = EXCLUDED.experience,
      id_proof = EXCLUDED.id_proof,
      live_photo = EXCLUDED.live_photo,
      state = EXCLUDED.state,
      district = EXCLUDED.district,
      pincode = EXCLUDED.pincode,
      id_proof_name = EXCLUDED.id_proof_name,
      address = EXCLUDED.address,
      verification_status = 'PENDING',
      availability = FALSE
    RETURNING
      provider_id,
      user_id,
      service_id,
      skill,
      experience,
      state,
      district,
      pincode,
      id_proof_name,
      address,
      verification_status,
      availability,
      created_at
  `;

  ok(res, 'Worker registration submitted for verification.', rows[0], 201);
});

// GET /api/providers/me

exports.getMine = asyncHandler(async (req, res) => {
  const rows = await db`
    ${db.unsafe(BASE)}
    WHERE p.user_id = ${req.user.user_id}
  `;

  if (!rows[0]) {
    throw new ApiError(404, 'Provider not found');
  }

  const upiRows = await db`
    SELECT upi_id
    FROM service_providers
    WHERE user_id = ${req.user.user_id}
  `;

  rows[0].upi_id = upiRows[0]?.upi_id ?? null;

  ok(res, 'Provider fetched', rows[0]);
});

// GET /api/upiid pay

exports.updateMyUpi = asyncHandler(async (req, res) => {
  const upiId = String(req.body.upi_id || '').trim();

  const rows = await db`
    UPDATE service_providers
    SET upi_id = ${upiId}
    WHERE user_id = ${req.user.user_id}
    RETURNING provider_id, upi_id
  `;

  if (!rows[0]) {
    throw new ApiError(404, 'Provider profile not found.');
  }

  ok(res, 'UPI ID saved successfully.', rows[0]);
});

// GET /api/providers/:id
exports.get = asyncHandler(async (req, res) => {
  const rows = await db`
    ${db.unsafe(BASE)}
    WHERE p.provider_id = ${req.params.id}
  `;
  if (!rows[0]) throw new ApiError(404, 'Provider not found');
  ok(res, 'Provider fetched', rows[0]);
});

// PUT /api/providers/:id  (own profile or admin). multipart: id_proof, live_photo
exports.update = asyncHandler(async (req, res) => {
  const found = await db`
    SELECT user_id, verification_status, latitude, longitude, location_updated_at
    FROM service_providers
    WHERE provider_id = ${req.params.id}
  `;
  if (!found[0]) throw new ApiError(404, 'Provider not found');
  if (req.user.role !== 'ADMIN' && found[0].user_id !== req.user.user_id) throw new ApiError(403, 'Forbidden');

  const {
    service_id,
    skill,
    experience,
    availability,
    google_place_id,
    sessionToken,
  } = req.body;
  let location = null;
  if (google_place_id) {
    location = await getPlaceDetails(
      google_place_id,
      sessionToken
    );
  } else if (sessionToken) {
    throw new ApiError(400, 'A valid place ID is required.');
  }
  if (availability === true) {
    if (found[0].verification_status !== 'VERIFIED') {
      throw new ApiError(403, 'Only verified providers can go online.');
    }
    const latitude = location?.latitude ?? found[0].latitude;
    const longitude = location?.longitude ?? found[0].longitude;
    if (
      latitude === null ||
      latitude === undefined ||
      longitude === null ||
      longitude === undefined
    ) {
      throw new ApiError(400, 'Coordinates are required to go online.');
    }
    const updatedAt = found[0].location_updated_at
      ? new Date(found[0].location_updated_at).getTime()
      : 0;
    if (!location && Date.now() - updatedAt > locationFreshnessMinutes() * 60 * 1000) {
      throw new ApiError(400, 'Refresh provider location before going online.');
    }
  }

  const idProof = req.files?.id_proof?.[0]
    ? await uploadBuffer(req.files.id_proof[0].buffer, 'id-proofs')
    : null;
  const livePhoto = req.files?.live_photo?.[0]
    ? await uploadBuffer(req.files.live_photo[0].buffer, 'live-photos')
    : null;

  const rows = await db`
    WITH updated_provider AS (
      UPDATE service_providers SET
        service_id = COALESCE(${service_id}, service_id),
        skill = COALESCE(${skill}, skill),
        experience = COALESCE(${experience}, experience),
        availability = COALESCE(${availability}, availability),
        latitude = COALESCE(${location?.latitude ?? null}, latitude),
        longitude = COALESCE(${location?.longitude ?? null}, longitude),
        address = COALESCE(${location?.formattedAddress ?? null}, address),
        city = COALESCE(${location?.city ?? null}, city),
        district = COALESCE(${location?.district ?? null}, district),
        state = COALESCE(${location?.state ?? null}, state),
        location_updated_at = CASE
          WHEN ${location?.latitude ?? null}::double precision IS NOT NULL
          THEN NOW()
          ELSE location_updated_at
        END,
        id_proof = COALESCE(${idProof}, id_proof),
        live_photo = COALESCE(${livePhoto}, live_photo),
        verification_status = CASE
          WHEN (${idProof} IS NOT NULL OR ${livePhoto} IS NOT NULL)
            AND verification_status = 'REJECTED'
          THEN 'PENDING'
          ELSE verification_status
        END
      WHERE provider_id = ${req.params.id}
      RETURNING *
    )
    SELECT * FROM updated_provider
  `;
  ok(res, 'Provider updated', rows[0]);
});

// PUT /api/providers/:id/verify (admin)  body: { status: VERIFIED | REJECTED | PENDING }
exports.verify = asyncHandler(async (req, res) => {
  const rows = await db`
    UPDATE service_providers
    SET verification_status = ${req.body.status}
    WHERE provider_id = ${req.params.id}
    RETURNING *
  `;
  if (!rows[0]) throw new ApiError(404, 'Provider not found');
  ok(res, `Provider ${req.body.status.toLowerCase()}`, rows[0]);
});

// GET /api/providers/:id/reviews
exports.reviews = asyncHandler(async (req, res) => {
  const rows = await db`
    SELECT r.review_id, r.rating, r.comment, r.created_at,
           u.name AS customer_name
    FROM reviews r
    JOIN users u ON u.user_id = r.customer_id
    WHERE r.provider_id = ${req.params.id}
    ORDER BY r.created_at DESC
  `;
  ok(res, 'Reviews fetched', rows);
});
