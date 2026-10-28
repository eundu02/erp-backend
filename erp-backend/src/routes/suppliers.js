const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ctrl = require('../controllers/suppliersController');

const router = express.Router();

router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getOne));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.delete('/:id', asyncHandler(ctrl.remove));

module.exports = router;
