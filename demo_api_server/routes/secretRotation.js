'use strict';

const express = require('express');
const { listApplicationsRaw } = require('../services/agentBuilderService');
const { isWorkerApp } = require('../services/pingOneSecretRotation');

const router = express.Router();

const SECRETFUL = new Set(['CLIENT_SECRET_BASIC', 'CLIENT_SECRET_POST', 'CLIENT_SECRET_JWT']);

router.get('/apps', async (_req, res) => {
  try {
    const raw = await listApplicationsRaw();
    const apps = raw
      .filter((a) => SECRETFUL.has(String(a.tokenEndpointAuthMethod || '').toUpperCase()))
      .filter((a) => !isWorkerApp(a))
      .map((a) => ({
        id: a.id, clientId: a.clientId, name: a.name,
        tokenEndpointAuthMethod: a.tokenEndpointAuthMethod,
      }));
    res.json({ apps });
  } catch (err) {
    res.status(502).json({ error: `Could not list applications: ${err.message}` });
  }
});

module.exports = router;
