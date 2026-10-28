const bcrypt = require('bcrypt');

const db = require('../config/db');
const ApiError = require('../utils/ApiError');
const generateToken = require('../utils/generateToken');
const { getPlaceDetails } = require('./locationService');


// ==================================================
// FIND USER BY PHONE
// ==================================================

const findUserByPhone = async (phone) => {
  const rows = await db`
    SELECT
      user_id,
      name,
      email,
      phone,
      role,
      address,
      latitude,
      longitude,

   
 
      
      is_active,
      is_verified,
      created_at
    FROM users
    WHERE phone = ${phone}
    LIMIT 1
  `;

  return rows[0] || null;
};


// ==================================================
// FIND USER BY EMAIL
// ==================================================

const findUserByEmail = async (email) => {
  const rows = await db`
    SELECT *
    FROM users
    WHERE email = LOWER(${email})
    LIMIT 1
  `;

  return rows[0] || null;
};


// ==================================================
// REGISTER USER
// ==================================================

const registerUser = async ({
  name,
  email,
  phone,
  password,
  role = 'CUSTOMER',
  // service_id,
  // skill,
  // experience,
}) => {
  // if (
  //   typeof google_place_id !== 'string' ||
  //   !/^[A-Za-z0-9_-]{1,255}$/.test(google_place_id)
  // ) {
  //   throw new ApiError(400, 'A valid place ID is required.');
  // }

  // const location = await getPlaceDetails(
  //    google_place_id,
  //   sessionToken
  // );

  // Check phone
  const existingPhone =
    await findUserByPhone(phone);

  if (existingPhone) {
    throw new ApiError(
      409,
      'Phone number is already registered.'
    );
  }


  // Check email
  const existingEmail =
    await findUserByEmail(email);

  if (existingEmail) {
    throw new ApiError(
      409,
      'Email is already registered.'
    );
  }


  // Hash password
  const passwordHash =
    await bcrypt.hash(password, 10);
  const rows = await db`
      INSERT INTO users
      (
        name,
        email,
        phone,
        password_hash,
        role,
        is_verified
      )
      VALUES
      (
        ${name},
        LOWER(${email}),
        ${phone},
        ${passwordHash},
        ${role},
        TRUE
      )
      RETURNING
        user_id,
        name,
        email,
        phone,
        role,
        is_active,
        is_verified,
        created_at
  `;

  const user = rows[0];
  const token = generateToken(user);

  return {
    user,
    token,
  };
};


// ==================================================
// LOGIN AFTER OTP
// ==================================================

const loginWithPhone = async (phone) => {

  const user =
    await findUserByPhone(phone)

  // New user
  if (!user) {
    return {
      isNewUser: true,
    };
  }
  // Blocked account
  if (!user.is_active) {
    throw new ApiError(
      403,
      'Account is blocked.'
    );
  }


  const token =
    generateToken(user);


  return {
    isNewUser: false,
    user,
    token,
  };
};

// LOGIN WITH PHONE AND PASSWORD

const loginWithPhoneAndPassword = async (phone, password) => {
  const rows = await db`
    SELECT
      user_id,
      name,
      email,
      phone,
      password_hash,
      profile_image,
      role,
      is_active,
      is_verified
    FROM users
    WHERE phone = ${phone}
    LIMIT 1
  `;

  const userRecord = rows[0];

  if (
    !userRecord ||
    !(await bcrypt.compare(password, userRecord.password_hash))
  ) {
    throw new ApiError(
      401,
      "Invalid phone number or password."
    );
  }

  if (!userRecord.is_active) {
    throw new ApiError(
      403,
      "Account is blocked."
    );
  }

  // Check whether the user is registered as a service provider.
  const providerRows = await db`
    SELECT
      provider_id,
      service_id,
      skill,
      experience,
      verification_status,
      address,
      district,
      state,
      pincode,
      id_proof_name,
      id_proof,
      live_photo,
      availability
    FROM service_providers
    WHERE user_id = ${userRecord.user_id}
    LIMIT 1
  `;

  const provider = providerRows[0] || null;

  // Remove the password hash from the response and JWT payload.
  const {
    password_hash,
    ...user
  } = userRecord;

  const token = generateToken(user);

  return {
    user,
    token,

    // True when the user has a service_providers record.
    worker_registration_is: Boolean(provider),

    // Return provider details when registered; otherwise null.
    provider: provider
      ? {
          provider_id: provider.provider_id,
          service_id: provider.service_id,
          skill: provider.skill,
          experience: provider.experience,
          verification_status: provider.verification_status,
          address: provider.address,
          district: provider.district,
          state: provider.state,
          pincode: provider.pincode,
          latitude: provider.latitude,
          longitude: provider.longitude,
          id_proof_name: provider.id_proof_name,
          id_proof: provider.id_proof,
          live_photo: provider.live_photo,
          availability: provider.availability,
        }
      : null,
  };
};



module.exports = {
  findUserByPhone,
  findUserByEmail,
  registerUser,
  loginWithPhone,
  loginWithPhoneAndPassword,
};