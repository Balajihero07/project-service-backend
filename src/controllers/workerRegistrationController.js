const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const generateToken = require('../utils/generateToken');
const { ok } = require('../utils/response');
const { uploadBuffer } = require('../config/cloudinary');

exports.getMyRegistration = asyncHandler(async (req, res) => {
  const rows = await db`
    SELECT
      u.user_id,
      u.name,
      u.email,
      u.phone,
      u.role,
      u.profile_image,
      p.provider_id,
      p.service_id,
      p.skill,
      p.experience,
      p.id_proof,
      p.id_proof_name,
      p.live_photo,
      p.address,
      p.city AS area,
      p.district,
      p.state,
      p.pincode,
      p.verification_status,
      p.availability,
      p.created_at AS provider_created_at
    FROM users u
    LEFT JOIN service_providers p ON p.user_id = u.user_id
    WHERE u.user_id = ${req.user.user_id}
  `;

  if (!rows[0]) throw new ApiError(404, 'User not found.');
  ok(res, 'Worker registration details fetched.', rows[0]);
});

exports.register = asyncHandler(async (req, res) => {
  const serviceId = Number(req.body.service_id);
  const eligibleServices = await db`
    SELECT service_id
    FROM services
    WHERE service_id = ${serviceId}
      AND is_active = TRUE
  `;
  if (!eligibleServices[0]) throw new ApiError(400, 'Select an active service.');

  const idProofFile = req.files?.id_proof?.[0];
  const profilePhotoFile = req.files?.profile_photo?.[0];
  const livePhotoFile = req.files?.live_photo?.[0];

  if (!idProofFile || !profilePhotoFile || !livePhotoFile) {
    throw new ApiError(
      400,
      'The id_proof, profile_photo, and live_photo images are required.'
    );
  }

  const [idProof, profilePhoto, livePhoto] = await Promise.all([
    uploadBuffer(idProofFile.buffer, 'id-proofs'),
    uploadBuffer(profilePhotoFile.buffer, 'profile-photos'),
    uploadBuffer(livePhotoFile.buffer, 'live-photos'),
  ]);

  const rows = await db`
    WITH updated_user AS (
      UPDATE users
      SET role = 'PROVIDER',
          profile_image = ${profilePhoto}
      WHERE user_id = ${req.user.user_id}
      RETURNING user_id
    ),
    upserted_provider AS (
      INSERT INTO service_providers (
        user_id,
        service_id,
        skill,
        experience,
        id_proof,
        id_proof_name,
        live_photo,
        address,
        city,
        district,
        state,
        pincode,
        verification_status,
        availability
      )
      SELECT
        user_id,
        ${serviceId},
        ${req.body.skill},
        ${Number(req.body.experience)},
        ${idProof},
        ${req.body.id_proof_name},
        ${livePhoto},
        ${req.body.address},
        ${req.body.area?.trim() || null},
        ${req.body.district},
        ${req.body.state},
        ${req.body.pincode},
        'PENDING',
        FALSE
      FROM updated_user
      ON CONFLICT (user_id) DO UPDATE SET
        service_id = EXCLUDED.service_id,
        skill = EXCLUDED.skill,
        experience = EXCLUDED.experience,
        id_proof = EXCLUDED.id_proof,
        id_proof_name = EXCLUDED.id_proof_name,
        live_photo = EXCLUDED.live_photo,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        district = EXCLUDED.district,
        state = EXCLUDED.state,
        pincode = EXCLUDED.pincode,
        verification_status = 'PENDING',
        availability = FALSE
      RETURNING
        provider_id,
        user_id,
        service_id,
        skill,
        experience,
        id_proof,
        id_proof_name,
        live_photo,
        address,
        city AS area,
        district,
        state,
        pincode,
        verification_status,
        availability,
        created_at
    )
    SELECT * FROM upserted_provider
  `;

  ok(
    res,
    'Worker registration submitted for verification.',
    {
      user: {
        user_id: req.user.user_id,
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        role: 'PROVIDER',
        profile_image: profilePhoto,
      },
      provider: rows[0],
      token: generateToken({ ...req.user, role: 'PROVIDER' }),
    },
    201
  );
});
