'use strict';

const guard = require('../../services/startupConfigGuard');

describe('startupConfigGuard — PingFederate provider', () => {
  const keys = [
    'OAUTH_PROVIDER', 'PF_ISSUER', 'PF_JWKS_URI', 'PF_TOKEN_ENDPOINT',
    'PINGONE_JWKS_URI', 'PINGONE_ISSUER', 'OAUTH_TOKEN_ENDPOINT', 'PINGONE_BASE_URL',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    process.env.OAUTH_PROVIDER = 'pingfederate';
    process.env.PF_ISSUER = 'https://pf.example.test';
    process.env.PF_JWKS_URI = 'https://pf.example.test/pf/JWKS';
    process.env.PF_TOKEN_ENDPOINT = 'https://pf.example.test/as/token.oauth2';
    delete process.env.PINGONE_JWKS_URI;
    delete process.env.PINGONE_ISSUER;
    delete process.env.OAUTH_TOKEN_ENDPOINT;
    delete process.env.PINGONE_BASE_URL;
  });

  afterEach(() => {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  test('does not apply PingOne management-host URL warnings to PF endpoints', () => {
    const issues = guard.collectIssues();
    expect(issues.some((issue) => issue.includes('Management API host'))).toBe(false);
  });

  test('requires an HTTPS PF issuer', () => {
    process.env.PF_ISSUER = 'http://pf.example.test';
    expect(guard.collectIssues().some((issue) => issue.includes('PF_ISSUER'))).toBe(true);
  });
});
