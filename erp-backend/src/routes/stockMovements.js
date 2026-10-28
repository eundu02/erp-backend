const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/inventoryController');

const router = express.Router();

router.get('/', asyncHandler(ctrl.listMovements));

module.exports = router;
