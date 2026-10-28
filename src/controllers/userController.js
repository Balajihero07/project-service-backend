const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { ok } = require('../utils/response');
const { uploadBuffer } = require('../config/cloudinary');
const { getPlaceDetails } = require('../services/locationService');

// GET /api/users/profile
exports.getProfile = asyncHandler(async (req, res) => {
  const rows = await db`
    SELECT
      user_id, name, email, phone, role, profile_image, address,
      latitude, longitude, city, district, state, google_place_id,
      is_active, created_at, updated_at
    FROM users
    WHERE user_id = ${req.user.user_id}
  `;
  ok(res, 'Profile fetched', rows[0]);
});

// PUT /api/users/profile  (optional multipart field: profile_image)
exports.updateProfile = asyncHandler(async (req, res) => {
  const {
    name,
    phone,
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

  const image = req.file
    ? await uploadBuffer(req.file.buffer, 'profiles')
    : null;

  const rows = await db`
    WITH updated_user AS (
      UPDATE users SET
        name = COALESCE(${name}, name),
        phone = COALESCE(${phone}, phone),
        profile_image = COALESCE(${image}, profile_image),
        address = COALESCE(${location?.formattedAddress ?? null}, address),
        latitude = COALESCE(${location?.latitude ?? null}, latitude),
        longitude = COALESCE(${location?.longitude ?? null}, longitude),
        city = COALESCE(${location?.city ?? null}, city),
        district = COALESCE(${location?.district ?? null}, district),
        state = COALESCE(${location?.state ?? null}, state),
        google_place_id = COALESCE(${location?.placeId ?? null}, google_place_id)
      WHERE user_id = ${req.user.user_id}
      RETURNING
        user_id, name, email, phone, role, profile_image, address,
        latitude, longitude, city, district, state, google_place_id,
        is_active, created_at, updated_at
    ),
    updated_provider AS (
      UPDATE service_providers SET
        latitude = COALESCE(${location?.latitude ?? null}, latitude),
        longitude = COALESCE(${location?.longitude ?? null}, longitude),
        location_updated_at = CASE
          WHEN ${location?.latitude ?? null}::double precision IS NOT NULL
          THEN NOW()
          ELSE location_updated_at
        END
      WHERE user_id = (SELECT user_id FROM updated_user)
      RETURNING provider_id
    )
    SELECT * FROM updated_user
  `;
  ok(res, 'Profile updated', rows[0]);
});

// DELETE /api/users/:id  (self or admin) -> soft delete (deactivate)
exports.deleteUser = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role !== 'ADMIN' && req.user.user_id !== id) throw new ApiError(403, 'Forbidden');
  const rows = await db`
    UPDATE users
    SET is_active = FALSE
    WHERE user_id = ${id}
    RETURNING user_id
  `;
  if (!rows.length) throw new ApiError(404, 'User not found');
  ok(res, 'User deactivated');
});
