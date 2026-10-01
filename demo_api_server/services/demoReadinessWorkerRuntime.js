'use strict';

const crypto = require('node:crypto');
const { createDemoReadinessProviderLoginClient } = require('./demoReadinessProviderLoginClient');

const TARGETS = ['local', 'se'];
const PROVIDERS = ['pingone', 'pingfederate'];

function laneSecretNames(targetId, provider) {
  const prefix = `DEMO_READINESS_${targetId.toUpperCase()}_${provider.toUpperCase()}_`;
  return {
    workerToken: `${prefix}WORKER_TOKEN`,
    username: `${prefix}USERNAME`,
    password: `${prefix}PASSWORD`,
    expectedSubject: `${prefix}EXPECTED_SUBJECT`,
  };
}

function httpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/' ? url.origin : null;
  } catch { return null; }
}

// Non-secret lane identity comes from env; credentials come from `readSecret`
// (the vault in production). Errors name settings, never values.
function loadLaneSettings({ env = process.env, readSecret } = {}) {
  const missing = [];
  const need = (name, value, ok = (v) => typeof v === 'string' && v.trim()) => {
    if (!ok(value)) { missing.push(name); return null; }
    return typeof value === 'string' ? value.trim() : value;
  };
  const targetId = need('DEMO_READINESS_WORKER_TARGET', env.DEMO_READINESS_WORKER_TARGET, (v) => TARGETS.includes(v));
  const provider = need('DEMO_READINESS_WORKER_PROVIDER', env.DEMO_READINESS_WORKER_PROVIDER, (v) => PROVIDERS.includes(v));
  const identityRef = need('DEMO_READINESS_WORKER_IDENTITY_REF', env.DEMO_READINESS_WORKER_IDENTITY_REF);
  const bffUrl = need('DEMO_READINESS_WORKER_BFF_URL', httpsOrigin(env.DEMO_READINESS_WORKER_BFF_URL || ''));
  const expectedIssuer = need('DEMO_READINESS_WORKER_EXPECTED_ISSUER', env.DEMO_READINESS_WORKER_EXPECTED_ISSUER);

  const secrets = {};
  if (targetId && provider) {
    const names = laneSecretNames(targetId, provider);
    for (const [field, name] of Object.entries(names)) secrets[field] = need(name, readSecret(name));
  }
  if (missing.length) throw new Error(`Readiness worker settings missing or invalid: ${missing.join(', ')}.`);
  return { targetId, provider, identityRef, bffUrl, expectedIssuer, ...secrets };
}

function createLaneSessionFactory(settings, { loginClient = createDemoReadinessProviderLoginClient } = {}) {
  const { targetId, provider, identityRef } = settings;
  return async function createSession(request = {}) {
    if (request.targetId !== targetId || request.provider !== provider || request.identityRef !== identityRef) {
      throw new Error('Requested session does not match this worker lane.');
    }
    const handle = await loginClient({
      provider,
      dedicatedBffUrl: settings.bffUrl,
      identityRef,
      username: settings.username,
      password: settings.password,
      expectedIssuer: settings.expectedIssuer,
      expectedSubject: settings.expectedSubject,
    });
    const id = () => crypto.randomUUID();
    // Non-enumerable so a serialised session can never carry the login handle.
    const session = {
      userSession: { authenticated: true, provider, identityRef },
      runtimeId: `${targetId}-${provider}-runtime-${id()}`,
      cookieJarId: `${targetId}-${provider}-cookies-${id()}`,
      sessionStoreId: `${targetId}-${provider}-store-${id()}`,
      async dispose() { await handle.dispose(); },
    };
    Object.defineProperty(session, 'login', { value: handle, enumerable: false });
    return session;
  };
}

module.exports = { laneSecretNames, loadLaneSettings, createLaneSessionFactory };
