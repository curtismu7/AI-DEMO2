'use strict';
const express = require('express');
const axios = require('axios');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { getManagementToken } = require('../services/pingOneClientService');
const mfaService = require('../services/mfaService');
const configStore = require('../services/configStore');
const { PingOneProvisionService, DEMO_PASSWORD } = require('../services/pingoneProvisionService');

router.post('/provision-user', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid email is required' });
  }

  const envId  = configStore.getEffective('pingone_environment_id') || configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('pingone_region') || configStore.getEffective('PINGONE_REGION') || 'com';
  const apiBase = `https://api.pingone.${region}/v1/environments/${envId}`;

  const steps = [];
  let userId = null;

  // ── Step 1: Obtain worker token ───────────────────────────────────────────
  let workerToken;
  try {
    workerToken = await getManagementToken();
  } catch (err) {
    return res.status(503).json({ error: 'management_token_failed', message: err.message });
  }

  // ── Step 1: Look up or create PingOne user ───────────────────────────────
  // Idempotent: if a user with this email/username already exists, reuse it
  // and proceed to set password / mayAct / MFA.
  try {
    const lookupSvc = new PingOneProvisionService();
    lookupSvc.baseURL = apiBase;
    lookupSvc.workerToken = workerToken;
    const existingUser = await lookupSvc.findUserByUsername(email);

    if (existingUser) {
      userId = existingUser.id;
      steps.push({ name: 'Create PingOne user', status: 'ok', detail: `already_exists — userId: ${userId}` });
    } else {
      const resp = await axios.post(`${apiBase}/users`, {
        username: email,
        email,
        name: { given: 'Demo', family: 'User' },
        enabled: true,
      }, {
        headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      userId = resp.data.id;
      steps.push({ name: 'Create PingOne user', status: 'ok', detail: `userId: ${userId}` });
    }

    // Password MUST be set via separate PUT — PingOne does not accept password in POST body.
    // Content-Type MUST be the vendor type; plain application/json is rejected.
    await axios.put(`${apiBase}/users/${userId}/password`, { value: DEMO_PASSWORD }, {
      headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/vnd.pingidentity.password.set+json' },
      timeout: 10000,
    });
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    steps.push({ name: 'Create PingOne user', status: 'error', detail });
    steps.push({ name: 'Set may_act attribute', status: 'skipped', detail: 'Skipped — depends on failed step above.' });
    steps.push({ name: 'Enroll email OTP MFA', status: 'skipped', detail: 'Skipped — depends on failed step above.' });
    return res.json({ steps, credentials: null });
  }

  // ── Step 2: Set mayAct attribute ──────────────────────────────────────────
  // Attribute name is 'mayAct' (camelCase) — NOT 'may_act'. Body shape: { sub: clientId }
  const mcpClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
    || configStore.getEffective('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID');

  if (!mcpClientId) {
    steps.push({
      name: 'Set may_act attribute',
      status: 'warning',
      detail: 'may_act not set — MCP token exchanger client ID not configured',
    });
  } else {
    try {
      await axios.patch(`${apiBase}/users/${userId}`, {
        mayAct: { sub: mcpClientId },
      }, {
        headers: { Authorization: `Bearer ${workerToken}`, 'Content-Type': 'application/json' },
        timeout: 12000,
      });
      steps.push({ name: 'Set may_act attribute', status: 'ok', detail: `mayAct.sub = ${mcpClientId}` });
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      steps.push({ name: 'Set may_act attribute', status: 'error', detail });
      // Non-fatal — continue to MFA enrollment
    }
  }

  // ── Step 3: Enroll email OTP MFA ──────────────────────────────────────────
  // mfaService.enrollEmailDevice gets its own worker token internally — do NOT pass workerToken
  // Worker-token enrollment creates device as ACTIVE immediately (no OTP round-trip required)
  try {
    const device = await mfaService.enrollEmailDevice(userId, email);
    steps.push({ name: 'Enroll email OTP MFA', status: 'ok', detail: `deviceId: ${device.id || '(enrolled)'}` });
  } catch (err) {
    steps.push({ name: 'Enroll email OTP MFA', status: 'error', detail: err.message });
  }

  return res.json({
    steps,
    credentials: { email, password: DEMO_PASSWORD },
  });
});

module.exports = router;
