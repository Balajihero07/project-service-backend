const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const generateOtp = require('../utils/generateOtp');
const ApiError = require('../utils/ApiError');

const OTP_EXPIRE_MINUTES =
  Number(process.env.OTP_EXPIRE_MINUTES) || 5;

const OTP_RESEND_SECONDS =
  Number(process.env.OTP_RESEND_SECONDS) || 30;

const OTP_MAX_ATTEMPTS =
  Number(process.env.OTP_MAX_ATTEMPTS) || 5;

const REGISTRATION_TOKEN_EXPIRE_MINUTES =
  Number(process.env.REGISTRATION_TOKEN_EXPIRE_MINUTES) || 10;

// Normalize phone number
const normalizePhone = (phone) => {
  return phone.replace(/\s+/g, '');
};
// Generate temporary registration token
const generateRegistrationToken = (phone) => {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(
      500,
      'JWT_SECRET must be configured to issue a registration token.'
    );
  }

  return jwt.sign(
    {
      phone,
      purpose: 'registration',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: `${REGISTRATION_TOKEN_EXPIRE_MINUTES}m`,
    }
  );
};

const verifyRegistrationToken = (phone, token) => {
  if (!process.env.JWT_SECRET) {
    throw new ApiError(
      500,
      'JWT_SECRET must be configured to verify a registration token.'
    );
  }

  if (typeof token !== 'string' || !token) {
    throw new ApiError(
      401,
      'A valid registration token is required.'
    );
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.JsonWebTokenError
    ) {
      throw new ApiError(
        401,
        'Registration token is invalid or expired. Please verify your phone again.'
      );
    }
    throw error;
  }

  if (
    typeof payload === 'string' ||
    payload.purpose !== 'registration' ||
    payload.phone !== normalizePhone(phone)
  ) {
    throw new ApiError(
      401,
      'Registration token does not match the verified phone number.'
    );
  }

  return payload.phone;
};

// SEND OTP


const createOtp = async (phone) => {
  phone = normalizePhone(phone);
  console.log('Normalized Phone:', phone);
  // Check previous OTP
  const rows = await db`
    SELECT id, last_sent_at
    FROM otp_verifications
    WHERE mobile_number = ${phone}
      AND verified = FALSE
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (rows.length > 0) {
  const lastSent = new Date(rows[0].last_sent_at);

  const difference =
    (Date.now() - lastSent.getTime()) / 1000;

  if (difference < OTP_RESEND_SECONDS) {
    const remaining = Math.ceil(
      OTP_RESEND_SECONDS - difference
    );

    throw new ApiError(
      429,
      `Please wait ${remaining} seconds before requesting another OTP`
    );
  }
}

  // Generate OTP
  const otp = generateOtp();

  // Hash OTP
  const otpHash = await bcrypt.hash(otp, 10);

  // Expiry
  const expiresAt = new Date(
    Date.now() + OTP_EXPIRE_MINUTES * 60 * 1000
  );

  // Invalidate old OTPs
  await db`
    UPDATE otp_verifications
    SET verified = TRUE
    WHERE mobile_number = ${phone}
      AND verified = FALSE
  `;

  // Insert new OTP
  await db`
    INSERT INTO otp_verifications
    (
      mobile_number,
      otp_hash,
      expires_at,
      attempts,
      verified,
      last_sent_at
    )
    VALUES (${phone}, ${otpHash}, ${expiresAt}, 0, FALSE, NOW())
  `;

  // Development only
  if (process.env.NODE_ENV === 'development') {
    console.log('');
    console.log('======================================');
    console.log('       PROJECT SERVICE OTP');
    console.log('======================================');
    console.log(`Phone : ${phone}`);
    console.log(`OTP   : ${otp}`);
    console.log(`Expiry: ${expiresAt.toLocaleTimeString()}`);
    console.log('======================================');
    console.log('');
  }

  return {
    phone,
    otp, 
    expiresIn: OTP_EXPIRE_MINUTES * 60,
    resendAfter: OTP_RESEND_SECONDS,
  };
};

// VERIFY OTP


const verifyOtp = async (phone, otp) => {
  phone = normalizePhone(phone);

  const rows = await db`
    SELECT *
    FROM otp_verifications
    WHERE mobile_number = ${phone}
      AND verified = FALSE
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new ApiError(
      400,
      'OTP not found. Please request a new OTP.'
    );
  }

  const otpRecord = rows[0];

  // Check expiry
  if (new Date(otpRecord.expires_at) < new Date()) {
    throw new ApiError(
      400,
      'OTP has expired. Please request a new OTP.'
    );
  }

  // Check attempts
  if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(
      429,
      'Maximum OTP attempts exceeded. Please request a new OTP.'
    );
  }

  // Compare OTP
  const valid = await bcrypt.compare(
    otp,
    otpRecord.otp_hash
  );

  if (!valid) {
    await db`
      UPDATE otp_verifications
      SET attempts = attempts + 1
      WHERE id = ${otpRecord.id}
    `;

    const remaining =
      OTP_MAX_ATTEMPTS -
      (otpRecord.attempts + 1);

    throw new ApiError(
      401,
      `Invalid OTP. ${remaining} attempt(s) remaining.`
    );
  }

  // Mark OTP verified
  await db`
    UPDATE otp_verifications
    SET verified = TRUE
    WHERE id = ${otpRecord.id}
  `;

  // Create temporary registration token
  const registrationToken =
    generateRegistrationToken(phone);

  return {
    phone,  
    registrationToken,
    registrationExpiresIn:
      REGISTRATION_TOKEN_EXPIRE_MINUTES * 60,
  };
};


module.exports = {
  createOtp,
  verifyOtp,
  verifyRegistrationToken,
  normalizePhone,
};