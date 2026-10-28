const asyncHandler =
  require('../utils/asyncHandler');

const ApiError =
  require('../utils/ApiError');

const { ok } =
  require('../utils/response');

const {
  createOtp,
  verifyOtp,
  verifyRegistrationToken,
  normalizePhone,
} = require('../services/otpService');

const {
  registerUser,
  loginWithPhone,
  loginWithPhoneAndPassword,
} = require('../services/authService');

// LOGIN WITH PHONE AND PASSWORD
exports.login = asyncHandler(
  async (req, res) => {
    const phone = normalizePhone(req.body.phone);
    const { password } = req.body;

    const result = await loginWithPhoneAndPassword(
      phone,
      password
    );
    ok(
      res,
      'Login successful.',
      result
    );

  }
);

// ==================================================
// SEND OTP
// ==================================================

exports.sendOtp = asyncHandler(
  async (req, res) => {

    const phone =
      normalizePhone(req.body.phone); 
    if (!phone) {
      throw new ApiError(
        400,
        'Phone number is required.'
      );
    }

    const result =
      await createOtp(phone);

    ok(
      res,
      'OTP sent successfully.',
      result
    );
  }
);


// ==================================================
// VERIFY OTP
// ==================================================

exports.verifyOtp = asyncHandler(
  async (req, res) => {

    const phone = normalizePhone(req.body.phone);

    const { otp } = req.body;


    if (!phone || !otp) {
      throw new ApiError(
        400,
        'Phone number and OTP are required.'
      );
    }


    if (!/^\d{6}$/.test(otp)) {
      throw new ApiError(
        400,
        'OTP must be exactly 6 digits.'
      );
    }


    // Verify OTP
    const verification =
      await verifyOtp(
        phone,
        otp
      );


    // Check whether user already exists
    const result =
      await loginWithPhone(phone);


    // Existing user
    if (!result.isNewUser) {

      return ok(
        res,
        'Login successful.',
        {
          isNewUser: false,
          user: result.user,
          token: result.token,
        }
      );
    }


    // New user
    return ok(
      res,
      'Phone verified. Please complete registration.',
      {
        isNewUser: true,
        phone: verification.phone,
        registrationToken:
          verification.registrationToken,
        registrationExpiresIn:
          verification.registrationExpiresIn,
      }
    );
  }
);
// REGISTER
exports.register = asyncHandler(
  async (req, res) => {
    const {
      name,
      email,
      phone,
      password,
      role = 'CUSTOMER',
      // google_place_id,
      // sessionToken,
      // service_id,
      // skill,
      // experience,
      registration_token,
    } = req.
    body;
    if (!name || !email || !phone || !password) {
      throw new ApiError(
        400,
        'Name, email, phone and password are required.'
      );
    }
    if (
      !['CUSTOMER', 'PROVIDER']
        .includes(role)
    ) {
      throw new ApiError(
        400,
        'Invalid role.'
      );
    }
    if (
      role === 'PROVIDER' &&
      !service_id
    ) {
      throw new ApiError(
        400,
        'service_id is required for providers.'
      );
    }
    // IMPORTANT:
    // Verify that this phone was recently verified by OTP
    const verifiedPhone = await verifyRegistrationToken(
      phone,
      registration_token
    );


    // Create user
    const result =
      await registerUser({
        name,
        email,
        phone: verifiedPhone,
        password,
        role,
        // google_place_id,
        // sessionToken,
        // service_id,
        // skill,
        // experience,
      });


    ok(
      res,
      'Registration successful.',
      result,
      201
    );
  }
);


// ==================================================
// LOGOUT
// ==================================================

exports.logout = (req, res) => {

  ok(
    res,
    'Logged out successfully.'
  );

};