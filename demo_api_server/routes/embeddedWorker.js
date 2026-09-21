'use strict';

const express = require('express');
const { requireSession } = require('../middleware/auth');
const svc = require('../services/agentBuilderService');

const router = express.Router();
router.use(requireSession);

router.get('/state', async (req, res, next) => {
  try {
    const agent = await svc.getEmbeddedWorkerForUser(req.session.user);
    const cimd = agent
      ? await svc.ensurePersonalAgentCimd(req.session.user, agent, { agentType: 'saas-embedded-worker' })
      : null;
    res.json({ agent: agent ? { ...agent, cimd } : null });
  } catch (err) { next(err); }
});

router.post('/agent', async (req, res, next) => {
  try {
    const result = await svc.createEmbeddedWorkerForUser(req.session.user);
    const cimd = result.agent
      ? await svc.ensurePersonalAgentCimd(req.session.user, result.agent, { agentType: 'saas-embedded-worker' })
      : null;
    res.status(result.created ? 201 : 200).json({ ...result, cimd });
  } catch (err) { next(err); }
});

module.exports = router;
