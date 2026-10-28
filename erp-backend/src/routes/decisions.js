const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/decisionsController');

const router = express.Router();

router.get('/', asyncHandler(ctrl.list));
router.get('/evaluation', asyncHandler(ctrl.evaluation));
router.post('/', asyncHandler(ctrl.create));
router.post('/convert-to-po', asyncHandler(ctrl.convertToPo));

module.exports = router;
