'use strict';

/**
 * GET /api/auth/oauth/user/login-trace/:id — serves the recorded login
 * sequence once, so the SPA can render the completed step-by-step diagram
 * right after landing back signed in. See loginFlowTraceService.js.
 */

const express = require('express');
const request = require('supertest');

const loginFlowTrace = require('../services/loginFlowTraceService');
const router = require('../routes/oauthUser');

const app = express();
app.use('/api/auth/oauth/user', router);

test('returns the recorded steps for a known trace id, in order', async () => {
  loginFlowTrace.start('t-abc');
  loginFlowTrace.addStep('t-abc', { title: 'You click "Sign in"' });
  loginFlowTrace.addStep('t-abc', { title: 'BFF mints PKCE' });

  const res = await request(app).get('/api/auth/oauth/user/login-trace/t-abc');

  expect(res.status).toBe(200);
  expect(res.body.steps.map((s) => s.title)).toEqual(['You click "Sign in"', 'BFF mints PKCE']);
});

test('is single-consume — a second fetch of the same id returns no steps', async () => {
  loginFlowTrace.start('t-def');
  loginFlowTrace.addStep('t-def', { title: 'once' });

  await request(app).get('/api/auth/oauth/user/login-trace/t-def');
  const second = await request(app).get('/api/auth/oauth/user/login-trace/t-def');

  expect(second.body.steps).toEqual([]);
});

test('an unknown id returns 200 with no steps, not an error', async () => {
  const res = await request(app).get('/api/auth/oauth/user/login-trace/never-existed');

  expect(res.status).toBe(200);
  expect(res.body.steps).toEqual([]);
});
