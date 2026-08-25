'use strict';

const { ALLOWED_ENV_VARS } = require('../scripts/vault-migrate');

describe('vault-migrate ALLOWED_ENV_VARS', () => {
  it('includes the keys that caused the 2026-08-25 SE introspection incident', () => {
    expect(ALLOWED_ENV_VARS).toContain('GW_INTROSPECTION_CLIENT_ID');
    expect(ALLOWED_ENV_VARS).toContain('GW_INTROSPECTION_CLIENT_SECRET');
  });

  it('has no duplicate entries', () => {
    const unique = new Set(ALLOWED_ENV_VARS);
    expect(unique.size).toBe(ALLOWED_ENV_VARS.length);
  });
});
