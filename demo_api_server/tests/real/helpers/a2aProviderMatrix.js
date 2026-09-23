'use strict';

function normalizeIssuer(issuer) {
  return typeof issuer === 'string' ? issuer.replace(/\/+$/, '') : '';
}

function assertProviderIssuer(provider, tokenIssuer, configuredIssuer = '') {
  if (!['pingone', 'pingfederate'].includes(provider)) {
    throw new Error('A2A_EXPECTED_OAUTH_PROVIDER must be pingone or pingfederate');
  }
  const expected = normalizeIssuer(configuredIssuer);
  const actual = normalizeIssuer(tokenIssuer);
  if (!expected || actual !== expected) {
    throw new Error(`A2A provider-matrix session issuer does not match configured ${provider} issuer`);
  }
  if (provider === 'pingone' && !/^https:\/\/auth\.pingone\.[^/]+\/[^/]+\/as$/i.test(actual)) {
    throw new Error('A2A provider-matrix session issuer is not PingOne');
  }
}

function assertVerticalActivated(activated, provider, vertical) {
  if (activated) return;
  if (provider) throw new Error(`${provider} A2A provider-matrix run could not activate vertical '${vertical}'`);
}

function assertActiveProvider(expected, actual) {
  if (expected && expected !== actual) {
    throw new Error(`A2A provider-matrix expected ${expected}, but API runtime is configured for ${actual}`);
  }
}

module.exports = { assertProviderIssuer, assertVerticalActivated, assertActiveProvider };
