const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/recommendationsController');

const router = express.Router();

router.get('/', asyncHandler(ctrl.list));
router.post('/calculate', asyncHandler(ctrl.calculate));

module.exports = router;
