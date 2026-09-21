'use strict';

const express = require('express');
const { createHostedRegistrationService } = require('../services/hostedRegistrationService');
const { sendHostedRegistrationAdminAlert } = require('../services/emailService');
const { createHostedRegistrationProvisioningService } = require('../services/hostedRegistrationProvisioningService');

const router = express.Router();
const registrationService = createHostedRegistrationService();
const provisioningService = createHostedRegistrationProvisioningService();

function publicError(res, error, status = 400) {
  return res.status(status).json({ error });
}

router.post('/request', async (req, res) => {
  try {
    const result = await registrationService.request({
      email: req.body?.email,
      firstName: req.body?.firstName,
      lastName: req.body?.lastName,
      requestedRole: req.body?.requestedRole,
    });
    return res.status(202).json(result);
  } catch (error) {
    if (error.message?.includes('pingidentity.com')) return publicError(res, 'pingidentity_email_required');
    if (error.code === 'registration_email_unconfigured') return publicError(res, 'registration_email_unavailable', 503);
    return publicError(res, 'registration_unavailable', 503);
  }
});

router.post('/verify', async (req, res) => {
  const result = await registrationService.verify(req.body?.requestId, req.body?.otp);
  if (result.error === 'request_not_found') return publicError(res, result.error, 404);
  if (result.error) return publicError(res, result.error, result.error === 'invalid_otp' ? 400 : 409);
  try {
    const staged = await provisioningService.stage(result);
    registrationService.update(result.id, { pingOneUserId: staged.pingOneUserId, groups: staged.groups });
  } catch (error) {
    console.warn('[hosted-registration] PingOne partial staging failed:', error.code || error.message);
  }
  try {
    await sendHostedRegistrationAdminAlert(result);
  } catch (error) {
    console.warn('[hosted-registration] admin notification failed:', error.code || error.message);
  }
  return res.status(200).json({ requestId: result.id, status: result.status });
});

router.post('/resend', async (req, res) => {
  try {
    return res.status(202).json(await registrationService.request({ email: req.body?.email }));
  } catch (error) {
    if (error.message?.includes('pingidentity.com')) return publicError(res, 'pingidentity_email_required');
    if (error.code === 'registration_email_unconfigured') return publicError(res, 'registration_email_unavailable', 503);
    return publicError(res, 'registration_unavailable', 503);
  }
});

router.get('/status', (req, res) => {
  const result = registrationService.get(req.query.requestId);
  if (!result) return publicError(res, 'request_not_found', 404);
  return res.json({ requestId: result.id, status: result.status, updatedAt: result.updatedAt });
});

module.exports = router;
