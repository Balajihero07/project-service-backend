const router = require('express').Router();
const controller = require('../controllers/locationController');
const { protect } = require('../middleware/auth');

router.get('/autocomplete', protect, controller.autocomplete);
router.get('/details', protect, controller.details);

module.exports = router;
