'use strict';

const express = require('express');
const request = require('supertest');
const session = require('express-session');
const { createHostedSessionMiddleware } = require('../../middleware/hostedSession');

function buildApp() {
  const app = express();
  const appStore = new session.MemoryStore();
  const hostedStore = new session.MemoryStore();

  app.use(session({
    secret: 'application-secret',
    store: appStore,
    resave: false,
    saveUninitialized: false,
  }));
  app.use(createHostedSessionMiddleware({
    store: hostedStore,
    secret: 'hosted-secret',
    production: false,
  }));

  app.get('/set-app', (req, res) => {
    req.session.demoUser = 'demo-user';
    res.json({ ok: true });
  });
  app.get('/set-hosted', (req, res) => {
    req.hostedSession.approved = true;
    req.hostedSession.save((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  });
  app.get('/logout-hosted', (req, res) => {
    req.hostedSession.destroy((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    });
  });
  app.get('/state', (req, res) => {
    res.json({
      appUser: req.session.demoUser || null,
      hostedApproved: req.hostedSession.approved === true,
      appSessionId: req.sessionID,
      hostedSessionId: req.hostedSession.id,
    });
  });
  return app;
}

describe('hostedSession', () => {
  test('keeps front-door state independent from the application session', async () => {
    const agent = request.agent(buildApp());

    await agent.get('/set-app').expect(200);
    await agent.get('/set-hosted').expect(200);

    const state = await agent.get('/state').expect(200);
    expect(state.body.appUser).toBe('demo-user');
    expect(state.body.hostedApproved).toBe(true);
    expect(state.body.appSessionId).not.toBe(state.body.hostedSessionId);

    await agent.get('/logout-hosted').expect(200);
    const afterLogout = await agent.get('/state').expect(200);
    expect(afterLogout.body.appUser).toBe('demo-user');
    expect(afterLogout.body.hostedApproved).toBe(false);
  });

  test('uses a distinct secure cookie name in production mode', () => {
    const middleware = createHostedSessionMiddleware({
      store: new session.MemoryStore(),
      secret: 'hosted-secret',
      production: true,
    });
    expect(middleware.cookieName).toBe('hosted.sid');
  });
});
