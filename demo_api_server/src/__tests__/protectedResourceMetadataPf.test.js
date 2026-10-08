'use strict';

const express = require('express');
const request = require('supertest');

const mockGetEffective = jest.fn();
jest.mock('../../services/configStore', () => ({ getEffective: (...args) => mockGetEffective(...args) }));

const router = require('../../routes/protectedResourceMetadata');

const app = express();
app.use('/api/rfc9728', router);

const settings = (values) => (key) => values[key] || '';
const PF = 'https://pf.example.test';

describe('RFC 9728 metadata for PingFederate', () => {
  const env = { ...process.env };
  beforeEach(() => {
    mockGetEffective.mockReset();
    process.env.PINGONE_ENVIRONMENT_ID = 'env-123';
  });
  afterEach(() => { process.env = { ...env }; });

  test('/metadata/pingfederate advertises the configured PF issuer, not the PingOne one', async () => {
    mockGetEffective.mockImplementation(settings({ pf_issuer: PF }));

    const res = await request(app).get('/api/rfc9728/metadata/pingfederate').expect(200);

    expect(res.body.authorization_servers).toEqual([PF]);
    expect(res.body.resource).toMatch(/\/api$/);
  });

  test('/metadata/pingfederate answers 503 when no PF issuer is configured', async () => {
    mockGetEffective.mockReturnValue('');
    const res = await request(app).get('/api/rfc9728/metadata/pingfederate').expect(503);
    expect(res.body).toEqual({ error: 'pf_issuer_not_configured' });
  });

  test('/metadata advertises the PingOne issuer when PingOne is the provider', async () => {
    const res = await request(app).get('/api/rfc9728/metadata').expect(200);
    expect(res.body.authorization_servers).toEqual(['https://auth.pingone.com/env-123/as']);
  });

  test('the public document and /metadata follow OAUTH_PROVIDER=pingfederate', async () => {
    mockGetEffective.mockImplementation(settings({ oauth_provider: 'pingfederate', pf_issuer: PF }));
    const wellKnown = express();
    wellKnown.use('/.well-known/oauth-protected-resource', router);

    const root = await request(wellKnown).get('/.well-known/oauth-protected-resource').expect(200);
    const meta = await request(app).get('/api/rfc9728/metadata').expect(200);

    expect(root.body.authorization_servers).toEqual([PF]);
    expect(meta.body.authorization_servers).toEqual([PF]);
  });

  test('in PingFederate mode with no PF_ISSUER the document names no authorization server', async () => {
    mockGetEffective.mockImplementation(settings({ oauth_provider: 'pingfederate' }));
    const res = await request(app).get('/api/rfc9728/metadata').expect(200);
    expect(res.body.authorization_servers).toBeUndefined();
  });
});
