const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/serviceController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

const id = param('id').isInt({ min: 1 });

router.get('/', c.list);
router.get('/:id', id, validate, c.get);

router.post('/', protect, authorize('ADMIN'), [
  body('service_name').trim().notEmpty(),
  body('base_price').optional().isFloat({ min: 0 }),
], validate, c.create);

router.put('/:id', protect, authorize('ADMIN'), [
  id, body('base_price').optional().isFloat({ min: 0 }), body('is_active').optional().isBoolean(),
], validate, c.update);

router.delete('/:id', protect, authorize('ADMIN'), id, validate, c.remove);

module.exports = router;
