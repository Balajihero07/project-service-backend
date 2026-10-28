const router = require('express').Router();
const { body } = require('express-validator');
const c = require('../controllers/reviewController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

router.post('/', protect, authorize('CUSTOMER'), [
  body('booking_id').isInt({ min: 1 }),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1 to 5'),
  body('comment').optional().isLength({ max: 1000 }),
], validate, c.create);

module.exports = router;
