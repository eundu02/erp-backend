const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/purchaseOrdersController');

const router = express.Router();

router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getOne));
router.post('/', asyncHandler(ctrl.create));
router.post('/:id/confirm', asyncHandler(ctrl.confirm));
router.delete('/:id', asyncHandler(ctrl.remove));
router.post('/:id/cancel', asyncHandler(ctrl.cancel));

module.exports = router;
