'use strict';

const express = require('express');
const { createHostedRegistrationAdminService } = require('../services/hostedRegistrationAdminService');

const router = express.Router();
const service = createHostedRegistrationAdminService();

function handleError(res, error) {
  const status = error.code === 'registration_not_found' ? 404 : error.code === 'invalid_role' || error.code === 'invalid_registration_state' ? 409 : 502;
  return res.status(status).json({ error: error.code || 'hosted_registration_action_failed' });
}

router.get('/', (req, res) => res.json({ registrations: service.list({ status: req.query.status }) }));
router.post('/:id/approve', async (req, res) => {
  try { return res.json(await service.approve(req.params.id, { role: req.body?.role, adminId: req.user?.id })); } catch (error) { return handleError(res, error); }
});
router.post('/:id/reject', async (req, res) => {
  try { return res.json(await service.reject(req.params.id, { adminId: req.user?.id })); } catch (error) { return handleError(res, error); }
});
router.post('/:id/disable', async (req, res) => {
  try { return res.json(await service.disable(req.params.id, { adminId: req.user?.id })); } catch (error) { return handleError(res, error); }
});

module.exports = router;
