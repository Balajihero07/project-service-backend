const router = require('express').Router();
const { body, param, query } = require('express-validator');
const c = require('../controllers/providerController');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { protect, authorize } = require('../middleware/auth');

const id = param('id').isInt({ min: 1 });
const normalizeNearbyProviderBody = (req, res, next) => {
  req.body.provider_id ??= req.body.proveider_id;
  req.body.availability ??= req.body.avaliablbility;
  req.body.latitude ??= req.body.latidutudi;
  req.body.longitude ??= req.body.longititudi;
  next();
};
const normalizeExperience = (req, res, next) => {
  if (req.body.experience === undefined && req.body.experice !== undefined) {
    req.body.experience = req.body.experice;
  }
  next();
};
const useSavedLocationForInvalidCoordinates = (req, res, next) => {
  const isValidCoordinate = (value, min, max) => (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= min &&
    Number(value) <= max
  );
  if (!isValidCoordinate(req.query.lat, -90, 90) ||
      !isValidCoordinate(req.query.lng, -180, 180)) {
    delete req.query.lat;
    delete req.query.lng;
  }
  next();
};

router.get('/', [
  query('lat').optional().isFloat({ min: -90, max: 90 }),
  query('lng').optional().isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 500 }),
  query('service_id').optional().isInt(),
], validate, c.list);

router.get('/me', protect, authorize('PROVIDER'), c.getMine);

router.get('/nearby', protect, [
  query('service_id').isInt({ min: 1 }),
  query('lat').isFloat({ min: -90, max: 90 }),
  query('lng').isFloat({ min: -180, max: 180 }),
  query('radius_km').optional().isFloat({ min: 0.1, max: 500 }),
], validate, (req, res, next) => {
  req.query.radius = req.query.radius_km || req.query.radius;
  return c.list(req, res, next);
});

router.get('/getservice_provider', protect, useSavedLocationForInvalidCoordinates, [
  query('service_id').optional().isInt({ min: 1 }),
  query('lat').optional().isFloat({ min: -90, max: 90 }),
  query('lng').optional().isFloat({ min: -180, max: 180 }),
  query('radius').optional().isFloat({ min: 0.1, max: 500 }),
], validate, c.listForUser);

router.post('/nearby_service', protect, authorize('PROVIDER'), normalizeNearbyProviderBody, [
  body('availability').isBoolean().toBoolean(),
  body('latitude').optional().isFloat({ min: -90, max: 90 }),
  body('longitude').optional().isFloat({ min: -180, max: 180 }),
  body().custom((value) => {
    if (value.availability && (value.latitude === undefined || value.longitude === undefined)) {
      throw new Error('Coordinates are required to go online.');
    }
    if ((value.latitude === undefined) !== (value.longitude === undefined)) {
      throw new Error('Latitude and longitude must be provided together.');
    }
    return true;
  }),
], validate, c.updateLocationAvailability);

router.patch('/location', protect, authorize('PROVIDER'), [
  body('latitude').isFloat({ min: -90, max: 90 }),
  body('longitude').isFloat({ min: -180, max: 180 }),
], validate, c.updateOwnLocation);

router.get('/:id', id, validate, c.get);
router.get('/:id/reviews', id, validate, c.reviews);

router.post('/register', protect, authorize('PROVIDER'),
  upload.fields([{ name: 'id_proof', maxCount: 1 }, { name: 'live_photo', maxCount: 1 }]),
  normalizeExperience,
  [
    body('user_id').isInt({ min: 1 }),
    body('service_id').isInt({ min: 1 }),
    body('skill').trim().notEmpty().isLength({ max: 100 }),
    body('experience').isInt({ min: 0 }),
    body('state').trim().notEmpty().isLength({ max: 100 }),
    body('district').trim().notEmpty().isLength({ max: 100 }),
    body('pincode').matches(/^\d{6}$/),
    body('id_proof_name').trim().notEmpty().isLength({ max: 255 }),
    body('address').trim().notEmpty(),
  ],
  validate, c.register);


    router.put(
      '/me/upi',
      protect,
      authorize('PROVIDER'),
      [
        body('upi_id')
          .trim()
          .matches(/^[A-Za-z0-9._-]{2,100}@[A-Za-z0-9.-]{2,64}$/)
          .withMessage('Enter a valid UPI ID, for example name@upi.'),
      ],
      validate,
      c.updateMyUpi
    );


router.put('/:id', protect, authorize('PROVIDER', 'ADMIN'),
  upload.fields([{ name: 'id_proof', maxCount: 1 }, { name: 'live_photo', maxCount: 1 }]),
  [id,
   body('experience').optional().isInt({ min: 0 }),
   body('availability').optional().isBoolean().toBoolean(),
   body('google_place_id').optional().matches(/^[A-Za-z0-9_-]{1,255}$/)
     .withMessage('A valid place ID is required.'),
   body('sessionToken').optional().matches(/^[A-Za-z0-9_-]{1,128}$/)
     .withMessage('A valid location session token is required.')],
  validate, c.update);

router.put('/:id/verify', protect, authorize('ADMIN'), [
  id, body('status').isIn(['VERIFIED', 'REJECTED', 'PENDING']),
], validate, c.verify);



module.exports = router;
