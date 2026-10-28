const router = require('express').Router();
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/upload');
const validate = require('../middleware/validate');
const c = require('../controllers/workerRegistrationController');

router.get('/me', protect, c.getMyRegistration);

router.post(
  '/reg',
  protect,
  upload.fields([
    { name: 'id_proof', maxCount: 1 },
    { name: 'profile_photo', maxCount: 1 },
    { name: 'live_photo', maxCount: 1 },
  ]),
  [
    body('service_id').isInt({ min: 1 }),
    body('skill').trim().notEmpty().isLength({ max: 100 }),
    body('experience').isInt({ min: 0 }),
    body('state').trim().notEmpty().isLength({ max: 100 }),
    body('district').trim().notEmpty().isLength({ max: 100 }),
    body('area').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
    body('address').trim().notEmpty(),
    body('pincode').matches(/^\d{6}$/),
    body('id_proof_name').trim().notEmpty().isLength({ max: 150 }),
  ],
  validate,
  c.register
);

module.exports = router;
