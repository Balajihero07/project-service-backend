const router = require('express').Router();
const { body, param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const c = require('../controllers/bookingController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

const id = param('id').isInt({ min: 1 });
const customerOtpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => String(req.user.user_id),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: 'Too many OTP requests. Please try again later.',
  }),
});
const providerOtpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => String(req.user.user_id),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: 'Too many OTP attempts. Please try again later.',
  }),
});

router.use(protect);

router.post('/', authorize('CUSTOMER'), [
  body('service_id').isInt({ min: 1 }),
  body('booking_date').isISO8601().withMessage('booking_date must be an ISO date')
    .custom((v) => new Date(v) > new Date()).withMessage('booking_date must be in the future'),
  body('google_place_id').matches(/^[A-Za-z0-9_-]{1,255}$/)
    .withMessage('A valid place ID is required.'),
  body('sessionToken').matches(/^[A-Za-z0-9_-]{1,128}$/)
    .withMessage('A valid location session token is required.'),
], validate, c.create);

router.post('/userBookingLive', authorize('CUSTOMER'), [
  body('service_id').isInt({ min: 1 }),
  body('address').trim().notEmpty().isLength({ max: 500 }),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('description').optional().trim().isLength({ max: 2000 }),
], validate, c.createLive);

router.post('/userBookingDate', authorize('CUSTOMER'), [
  body('service_id').isInt({ min: 1 }),
  body('booking_date').isISO8601().withMessage('booking_date must be an ISO date')
    .custom((v) => new Date(v) > new Date()).withMessage('booking_date must be in the future'),
  body('address').trim().notEmpty().isLength({ max: 500 }),
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
  body('description').optional().trim().isLength({ max: 2000 }),
], validate, c.createScheduled);

router.get('/provider/active', authorize('PROVIDER'), [
  query('status').optional().isIn(['ACCEPTED', 'ON_THE_WAY', 'STARTED']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
], validate, c.providerActiveBookings);
router.get('/provider/history', authorize('PROVIDER'), [
 query('status').optional().isIn([
  'COMPLETED',
  'CANCELLED',
  'CLOSED',
 ]),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
], validate, c.providerBookingHistory);
router.get('/provider/requests', authorize('PROVIDER'), c.providerRequests);
router.post('/:id/accept', authorize('PROVIDER'), id, validate, c.accept);
router.post('/:id/reject', authorize('PROVIDER'), id, validate, c.reject);
router.post('/:id/otp', authorize('CUSTOMER'), customerOtpRateLimit, id, validate, c.generateOtp);
router.post('/:id/verify-otp', authorize('PROVIDER'), [
  id, body('otp').matches(/^\d{6}$/),
], validate, providerOtpRateLimit, c.verifyOtp);
router.post('/:id/complete', authorize('PROVIDER'), id, validate, (req, res, next) => {
  req.body.status = 'COMPLETED';
  return c.updateStatus(req, res, next);
});

router.get('/', c.list);
router.get('/:id', id, validate, c.get);

router.put('/:id/status', [
  id,
  body('status').isIn(['ON_THE_WAY', 'CANCELLED']),
], validate, c.updateStatus);

router.put('/:id/otp', authorize('PROVIDER'), [
  id, body('otp').matches(/^\d{6}$/),
], validate, providerOtpRateLimit, c.verifyOtp);

module.exports = router;
