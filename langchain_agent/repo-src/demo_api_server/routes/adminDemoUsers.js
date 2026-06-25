'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin, requireScopes } = require('../middleware/auth');
const pingOneUserService = require('../services/pingOneUserService');
const mfaService = require('../services/mfaService');
const dataStore = require('../data/store');

// POST /api/admin/demo-users — provision a fully-configured PingOne demo user
router.post('/', authenticateToken, requireScopes(['admin']), requireAdmin, async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    cell,
    password,
    delegation,        // { enabled: bool, targetUserId: string }
    enrollEmailOtp,    // bool
    enrollSmsOtp,      // bool
    seedBankingData,   // bool
  } = req.body;

  if (!firstName || !lastName || !email || !cell || !password) {
    return res.status(400).json({ error: 'firstName, lastName, email, cell, and password are required' });
  }

  const steps = {
    created: false,
    mobile: false,
    mayAct: false,
    emailOtp: false,
    smsOtp: false,
    banking: false,
  };
  const errors = {};
  let createdUser = null;

  // Step 1 — create PingOne user (abort on failure)
  try {
    pingOneUserService.initialize();
    createdUser = await pingOneUserService.createPingOneUser({
      email,
      username: email,
      firstName,
      lastName,
      password,
    });
    steps.created = true;
  } catch (err) {
    return res.status(502).json({
      error: 'Failed to create PingOne user',
      message: err.message,
      steps,
    });
  }

  const pingoneId = createdUser.id;

  // Step 2 — set mobile phone
  try {
    await pingOneUserService.updatePingOneUser(pingoneId, { mobilePhone: cell });
    steps.mobile = true;
  } catch (err) {
    errors.mobile = err.message;
  }

  // Step 3 — set may_act delegation
  if (delegation?.enabled && delegation?.targetUserId) {
    try {
      await pingOneUserService.setMayActAttribute(pingoneId, { sub: delegation.targetUserId });
      steps.mayAct = true;
    } catch (err) {
      errors.mayAct = err.message;
    }
  } else {
    steps.mayAct = true; // not requested — treat as success
  }

  // Step 4 — pre-enroll email OTP
  if (enrollEmailOtp) {
    try {
      await mfaService.enrollEmailDevice(pingoneId, email);
      steps.emailOtp = true;
    } catch (err) {
      errors.emailOtp = err.message;
    }
  } else {
    steps.emailOtp = true;
  }

  // Step 5 — pre-enroll SMS OTP
  if (enrollSmsOtp) {
    try {
      await mfaService.enrollSmsDevice(pingoneId, cell);
      steps.smsOtp = true;
    } catch (err) {
      errors.smsOtp = err.message;
    }
  } else {
    steps.smsOtp = true;
  }

  // Step 6 — seed demo banking data
  if (seedBankingData) {
    try {
      await dataStore.seedAccountsForUser(pingoneId);
      steps.banking = true;
    } catch (err) {
      errors.banking = err.message;
    }
  } else {
    steps.banking = true;
  }

  const allSucceeded = Object.values(steps).every(Boolean);
  const status = allSucceeded ? 201 : 207;

  const body = {
    user: {
      id: pingoneId,
      email,
      firstName,
      lastName,
    },
    pingoneId,
    steps,
  };
  if (!allSucceeded) body.errors = errors;

  res.status(status).json(body);
});

module.exports = router;
