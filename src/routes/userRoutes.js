const router = require('express').Router();
const { body, param } = require('express-validator');
const c = require('../controllers/userController');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { protect } = require('../middleware/auth');

router.use(protect);
router.get('/profile', c.getProfile);
router.put('/profile', upload.single('profile_image'), [
  body('name').optional().trim().notEmpty(),
  body('phone').optional().matches(/^[0-9+\-\s]{10,15}$/),
  // body('google_place_id').optional().matches(/^[A-Za-z0-9_-]{1,255}$/)
  //   .withMessage('A valid place ID is required.'),
  // body('sessionToken').optional().matches(/^[A-Za-z0-9_-]{1,128}$/)
  //   .withMessage('A valid location session token is required.'),
], validate, c.updateProfile);
router.delete('/:id', param('id').isInt(), validate, c.deleteUser);

module.exports = router;
