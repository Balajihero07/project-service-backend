const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/paymentController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

const id = param('id').isInt({ min: 1 });

router.use(protect);
router.post('/', authorize('CUSTOMER'), [
  body('booking_id').isInt({ min: 1 }),
  body('payment_method').isIn(['QR', 'ONLINE', 'WALLET', 'CASH']),
], validate, c.create);
router.get('/', c.list);
router.get('/:id', id, validate, c.get);
router.put('/:id/status', authorize('PROVIDER', 'ADMIN'), [
  id, body('status').isIn(['SUCCESS', 'FAILED', 'REFUNDED']),
], validate, c.updateStatus);

module.exports = router;
