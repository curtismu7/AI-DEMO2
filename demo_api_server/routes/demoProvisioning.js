'use strict';
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { getManagementToken } = require('../services/pingOneClientService');
const mfaService = require('../services/mfaService');
const configStore = require('../services/configStore');
const dataStore = require('../data/store');
const pingOneUserService = require('../services/pingOneUserService');
const { PingOneProvisionService, DEMO_PASSWORD } = require('../services/pingoneProvisionService');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { logger, LOG_CATEGORIES } = require('../utils/logger');

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
    const n = normalizeAxiosError(err, { label: 'PingOne provisioning' });
    const detail = n.message;
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
      const n = normalizeAxiosError(err, { label: 'PingOne provisioning' });
      const detail = n.message;
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

// ── Welcome-wizard provisioning ─────────────────────────────────────────────
// One call that sets up a demo person end to end: customer user (email as
// username) + admin user (plus-addressed +admin username), both with a random
// temp password marked forceChange, email+SMS OTP enrolled, and the admin user
// added to the admin_username allowlist so the BFF resolves admin at login.
// Idempotent: existing PingOne users are reused, not duplicated.

// Task 1 spike (2026-10-12): POST /users/{id}/password with the
// sendRecoveryCode vendor type returned 200 with the worker token — native
// email is available, so the gate ships ON.
const NATIVE_EMAIL_ENABLED = true;

/** Random temp password meeting the demo password policy (upper+lower+digit). */
function generateTempPassword() {
  // ponytail: crypto.randomInt-based, 14 chars — plenty for a demo temp password
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (chars) => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `${pick(upper)}${pick(lower)}${pick(digits)}${pick(all)}`;
}

/** Split an existing admin_username allowlist and append a username if absent. */
function appendAdminAllowlist(existing, username) {
  const entries = (existing || '').split(',').map(u => u.trim()).filter(Boolean);
  if (!entries.includes(username)) entries.push(username);
  return entries.join(', ');
}

async function provisionWizardUser({ email, username, cell, role, mcpClientId, prefix, errors }) {
  // Idempotent lookup — reuse existing user if the username is taken
  const found = await pingOneUserService.searchUsers(username);
  const existing = (found?._embedded?.users || []).find(u => u.username === username);
  const steps = {};

  // Mint one temp password up front — used for both new and reused users
  const password = generateTempPassword();

  let user;
  if (existing) {
    user = existing;
    steps.reused = true;
  } else {
    user = await pingOneUserService.createPingOneUser({
      email,
      username,
      firstName: 'Demo',
      lastName: role === 'admin' ? 'Admin' : 'User',
      password,
      role,
    });
    steps.created = true;
  }

  // Always re-set with forceChange so PingOne demands a new password at first
  // sign-in — also rotates the password on a reused (pre-existing) user.
  try {
    await pingOneUserService.setUserPassword(user.id, password, { forceChange: true });
    user._tempPassword = password;
  } catch (err) {
    errors[`${prefix}Password`] = err.message;
  }

  // Mobile phone — SMS MFA target
  try {
    await pingOneUserService.updatePingOneUser(user.id, { mobilePhone: cell });
    steps.mobile = true;
  } catch (err) {
    steps.mobile = false;
    errors[`${prefix}Mobile`] = err.message;
  }

  // mayAct delegation attribute — token exchanger client id
  try {
    await pingOneUserService.setMayActAttribute(user.id, { sub: mcpClientId });
    steps.mayAct = true;
  } catch (err) {
    steps.mayAct = false;
    errors[`${prefix}MayAct`] = err.message;
  }

  // Email + SMS OTP enrollment (worker-token path → ACTIVE immediately)
  try {
    await mfaService.enrollEmailDevice(user.id, email);
    steps.emailOtp = true;
  } catch (err) {
    steps.emailOtp = false;
    errors[`${prefix}EmailOtp`] = err.message;
  }
  try {
    await mfaService.enrollSmsDevice(user.id, cell);
    steps.smsOtp = true;
  } catch (err) {
    steps.smsOtp = false;
    errors.sms = err.message;
  }

  return { user, steps };
}

router.post('/provision-wizard', requireAdmin, async (req, res) => {
  const { email, cell } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid email is required' });
  }
  if (!cell || typeof cell !== 'string' || cell.length < 7) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid cell number is required' });
  }

  const mcpClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
    || configStore.getEffective('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID');
  if (!mcpClientId) {
    return res.status(503).json({ error: 'not_configured', message: 'MCP token exchanger client ID not configured — run bootstrap' });
  }

  const adminUsername = email.replace(/@/, '+admin@');
  const errors = {};

  try {
    pingOneUserService.initialize();
  } catch (err) {
    return res.status(503).json({ error: 'not_configured', message: err.message });
  }

  // Customer user
  const customer = await provisionWizardUser({ email, username: email, cell, role: 'customer', mcpClientId, prefix: 'customer', errors });

  // Seed banking data for the customer dashboard (non-fatal)
  try {
    await dataStore.seedAccountsForUser(customer.user.id);
  } catch (err) {
    errors.bankingData = err.message;
  }

  // Admin user
  const admin = await provisionWizardUser({ email, username: adminUsername, cell, role: 'admin', mcpClientId, prefix: 'admin', errors });

  // PingOne admin role assignments (worker can only grant roles it holds)
  let roleResult = null;
  try {
    roleResult = await pingOneUserService.ensureAdminRoleAssignments(admin.user.id);
    if (roleResult.failed?.length) errors.roleAssignments = roleResult.failed;
  } catch (err) {
    errors.roleAssignments = err.message;
  }

  // Append to the admin_username allowlist so the BFF resolves admin at login
  try {
    const existingList = configStore.getEffective('admin_username') || configStore.getEffective('ADMIN_USERNAME') || '';
    await configStore.setConfig({ admin_username: appendAdminAllowlist(existingList, adminUsername) });
  } catch (err) {
    errors.adminAllowlist = err.message;
  }

  const steps = {
    created: Boolean(customer.steps.created || admin.steps.created) || undefined,
    reused: Boolean(customer.steps.reused && admin.steps.reused) || undefined,
    customer: customer.steps,
    admin: admin.steps,
    roleAssignments: roleResult ? { assigned: roleResult.assigned, existing: roleResult.existing } : null,
  };
  const ok = Object.keys(errors).length === 0;

  const credentials = {
    customerUsername: email,
    adminUsername,
    password: customer.user._tempPassword || admin.user._tempPassword || null,
    passwordExpiresNote: 'User must set a new password at first sign-in (forceChange).',
  };

  return res.status(ok ? 201 : 207).json({ steps, errors: ok ? undefined : errors, credentials });
});

// POST /api/demo/send-invite — admin-triggered invite. Idempotently provisions
// the invitee's customer account (create-or-reuse, forceChange temp password,
// MFA, banking seed) and returns the /welcome registration link for the admin
// to hand over. Optional PingOne-native email behind the Task 1 spike gate.
router.post('/send-invite', requireAdmin, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'invalid_request', message: 'A valid email is required' });
  }

  const mcpClientId = configStore.getEffective('pingone_mcp_token_exchanger_client_id')
    || configStore.getEffective('PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID');
  if (!mcpClientId) {
    return res.status(503).json({ error: 'not_configured', message: 'MCP token exchanger client ID not configured — run bootstrap' });
  }
  try {
    pingOneUserService.initialize();
  } catch (err) {
    return res.status(503).json({ error: 'not_configured', message: err.message });
  }

  const errors = {};
  let user, steps;
  try {
    ({ user, steps } = await provisionWizardUser({
      email, username: email, cell: '', role: 'customer', mcpClientId, prefix: 'invite', errors,
    }));
  } catch (err) {
    logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite provisioning failed', { email, error: err.message });
    return res.status(503).json({ error: 'pingone_invite_failed', message: err.message });
  }
  if (!user?.id) {
    return res.status(503).json({ error: 'pingone_invite_failed', message: 'User provisioning failed' });
  }

  try { await dataStore.seedAccountsForUser(user.id); } catch (err) { errors.bankingData = err.message; }

  // Best-effort: park the invitee in the pending hosted-access group so the
  // approval flow's later move to the complete group mirrors the hosted
  // registration path. The invitee cannot pass the gate until approval moves
  // them (the gate requires the USER group, not this one) — this only keeps
  // the two flows symmetric. Never fatal: a group outage must not block the
  // invite itself.
  const partialGroupId = process.env.HOSTED_ACCESS_PARTIAL_GROUP_ID;
  if (partialGroupId && user?.id) {
    try {
      const { managementService } = require('../services/pingoneManagementService');
      const added = await managementService.addUserToGroup(user.id, partialGroupId);
      if (!added?.success) logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite pending-group add failed', { userId: user.id, error: added?.error });
    } catch (err) {
      logger.warn(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite pending-group add threw', { userId: user.id, error: err.message });
    }
  }

  // Native "set your password" email when the password + email-OTP steps
  // succeeded — sendRecoveryCode only needs an enabled user with a set
  // password, so SMS/cell failures don't block it.
  let nativeEmail = 'skipped';
  const passwordAndEmailOtpOk = !errors.invitePassword && !errors.inviteEmailOtp
    && steps.emailOtp !== false;
  if (passwordAndEmailOtpOk) {
    try {
      await pingOneUserService.sendPasswordSetupEmail(user.id, { enabled: NATIVE_EMAIL_ENABLED });
      nativeEmail = NATIVE_EMAIL_ENABLED ? 'sent' : 'skipped';
    } catch (err) {
      logger.error(LOG_CATEGORIES.USER_MANAGEMENT, 'send-invite native email failed', { userId: user.id, error: err.message });
      nativeEmail = 'failed';
    }
  }

  const registrationUrl = `${configStore.getEffective('public_app_url') || configStore.getEffective('PUBLIC_APP_URL') || 'https://ai-demo.ping-devops.com'}/welcome?welcome=1`;
  return res.status(201).json({ userId: user.id, invite: 'sent', nativeEmail, registrationUrl });
});

module.exports = router;
