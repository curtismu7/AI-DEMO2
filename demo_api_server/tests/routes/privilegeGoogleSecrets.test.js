'use strict';

// privilegeGoogleSecrets route: the Secrets Hub — Google Secret Manager demo.
// Contract under test:
//   - requireSession guards the endpoint (mocked open here)
//   - GET /hub serves the measured tenant snapshot + runbook facts, read-only
//   - no secret values and no service-account credentials anywhere in the payload
//   - the "does not" honesty list and the clear-text-key audit warning ship as data

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  requireSession: (req, res, next) => next(),
}));

const { router } = require('../../routes/privilegeGoogleSecrets');
const snapshot = require('../../data/secrets-hub-snapshot.json');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/privilege-google-secrets', router);
  return app;
}

describe('GET /api/privilege-google-secrets/hub', () => {
  it('serves the measured tenant snapshot', async () => {
    const res = await request(makeApp()).get('/api/privilege-google-secrets/hub');
    expect(res.status).toBe(200);
    expect(res.body.hub.name).toBe(snapshot.hub.name);
    expect(res.body.hub.provider).toBe('GCP');
    expect(res.body.secrets.length).toBeGreaterThanOrEqual(1);
    expect(res.body.source).toBe('console-export-snapshot');
  });

  it('includes the grant, the honesty list and the clear-text-key warning', async () => {
    const res = await request(makeApp()).get('/api/privilege-google-secrets/hub');
    expect(res.body.grant.name).toBe('YukonRiver-416146713043');
    expect(res.body.doesNot.length).toBeGreaterThanOrEqual(3);
    expect(res.body.doesNot.join(' ')).toMatch(/User Token auth mode/);
    expect(res.body.uncomfortable.fact).toMatch(/clear text/);
    expect(res.body.auditTrail).toHaveLength(2);
    expect(res.body.run).toHaveLength(4);
  });

  it('never ships secret values or service-account credentials', async () => {
    const res = await request(makeApp()).get('/api/privilege-google-secrets/hub');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/GcpJsonCreds/);
    expect(body).not.toMatch(/private_key/);
    // Secret entries carry id + path + provider (+ an optional provenance note) — never a value
    for (const s of res.body.secrets) {
      expect(Object.keys(s).filter((k) => k !== 'note').sort()).toEqual(['id', 'path', 'provider']);
      expect(s).not.toHaveProperty('value');
      if (s.note) expect(typeof s.note).toBe('string');
    }
  });

  it('is read-only: no state-changing methods are routed', async () => {
    const app = makeApp();
    const post = await request(app).post('/api/privilege-google-secrets/hub').send({});
    const del = await request(app).delete('/api/privilege-google-secrets/hub');
    expect([post.status, del.status]).toEqual([404, 404]);
  });
});
