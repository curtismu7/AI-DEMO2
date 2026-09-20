'use strict';

const express = require('express');
const { hostedAccessCheck } = require('../middleware/hostedAccessGate');

const router = express.Router();
router.get('/check', hostedAccessCheck());

module.exports = router;
