const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/adminController');
const validate = require('../middleware/validate');
const { protect, authorize } = require('../middleware/auth');

router.use(protect, authorize('ADMIN'));
router.get('/stats', c.stats);
router.get('/users', c.users);
router.get('/providers', c.providers);
router.put('/users/:id/block', [param('id').isInt({ min: 1 }), body('blocked').isBoolean()], validate, c.setBlocked);

module.exports = router;
