const router = require('express').Router();
const { body } = require('express-validator');
const c = require('../controllers/authController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
// PHONE VALIDATION
const phoneValidation =
  body('phone')
    .matches(/^\+[1-9]\d{7,14}$/)
    .withMessage(
      'Valid phone number required with country code'
    ); http://localhost:5000/api/health
// LOGIN WITH PHONE AND PASSWORD
router.post(
  '/login',
  [
    phoneValidation,
    body('password')
      .isString()
      .notEmpty()
      .withMessage('Password is required'),
  ],
  validate,
  c.login
);

// SEND OTP
router.post( '/send-otp',[phoneValidation,],validate,c.sendOtp);

// VERIFY OTP
router.post('/verify-otp',[ phoneValidation,body('otp')
      .matches(/^\d{6}$/)
      .withMessage(
        'OTP must be exactly 6 digits'
      ),
  ],
  validate,
  c.verifyOtp
);

// REGISTER
router.post('/register',[body('name')
      .trim()
      .notEmpty()
      .withMessage(
        'Name is required'
      ),
    body('email')
      .isEmail()
      .withMessage(
        'Valid email required'
      ),
    phoneValidation,
    // body('google_place_id')
    //   .matches(/^[A-Za-z0-9_-]{1,255}$/)
    //   .withMessage('A valid place ID is required.'),
    // body('sessionToken')
    //   .matches(/^[A-Za-z0-9_-]{1,128}$/)
    //   .withMessage('A valid location session token is required.'),
    body('role')
      .optional()
      .isIn([
        'CUSTOMER',
        'PROVIDER',
      ])
      .withMessage(
        'Role must be CUSTOMER or PROVIDER'
      ),

    body('service_id')
      .if(
        body('role')
          .equals('PROVIDER')
      )
      .isInt({
        min: 1,
      })
      .withMessage(
        'service_id required for providers'
      ),

    body('experience')
      .optional()
      .isInt({
        min: 0,
      }),

  ],

  validate,

  c.register
);


// =====================================================
// LOGOUT
// =====================================================

router.post(
  '/logout',
  protect,
  c.logout
);


module.exports = router;