'use strict';

// POST /config must write to req.session so express-session (configured with
// saveUninitialized: false) issues the session cookie on that response. The
// procyon agent-gateway path skips /auth/start — previously the only session
// write — so without this a cookie-less client gets a fresh session on the
// next call and the saved gateway URL silently reverts to the env default.

const express = require('express');
const request = require('supertest');

test('POST /config marks the express session so the cookie is issued', async () => {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  const seenSessions = [];
  app.use((req, _res, next) => {
    req.sessionID = 'privilege-config-cookie-test';
    req.session = {};
    seenSessions.push(req.session);
    next();
  });
  app.use('/api/privilege-mcp', router);

  await request(app)
    .post('/api/privilege-mcp/config')
    .send({ mcpUrl: 'https://opensearch.default.applications.procyon.ai:8643/mcp' })
    .expect(200);

  expect(seenSessions).toHaveLength(1);
  expect(seenSessions[0].privilegeMcpConfigured).toBe(true);
});
