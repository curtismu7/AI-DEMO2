'use strict';

const TARGETS = Object.freeze(['local', 'se']);
const PROVIDERS = Object.freeze(['pingone', 'pingfederate']);
const TARGET_FIELDS = Object.freeze({
  bffUrl: 'BFF_URL',
  gatewayUrl: 'GATEWAY_URL',
  authorizeUrl: 'AUTHORIZE_URL',
  expectedRevision: 'EXPECTED_REVISION',
});
const WORKER_FIELDS = Object.freeze({
  url: 'WORKER_URL',
  token: 'WORKER_TOKEN',
  identityRef: 'IDENTITY_REF',
});

function envName(target, suffix, provider) {
  return `DEMO_READINESS_${target.toUpperCase()}_${provider ? provider.toUpperCase() + '_' : ''}${suffix}`;
}

function urlError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'is required';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
        || parsed.search || parsed.hash) {
      return 'must be an absolute HTTPS URL without embedded credentials, query, or fragment';
    }
    return null;
  } catch {
    return 'must be an absolute HTTPS URL without embedded credentials, query, or fragment';
  }
}

function revisionError(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{7,40}$/i.test(value.trim())) return 'must be a 7–40 character Git SHA';
  return null;
}

function requiredStringError(value) {
  if (typeof value !== 'string' || !value.trim()) return 'is required';
  if (/\s/.test(value)) return 'must not contain whitespace';
  return null;
}

function addFinding(findings, id, name, reason) {
  findings.push({
    id,
    status: 'blocked',
    required: true,
    evidence: `${name} ${reason}.`,
  });
}

function loadDemoReadinessRuntimeConfig(env = process.env) {
  const findings = [];
  const targets = {};
  const workerValues = new Map();

  for (const target of TARGETS) {
    const targetConfig = { id: target, kind: target === 'se' ? 'se' : 'local', workers: {} };
    for (const [field, suffix] of Object.entries(TARGET_FIELDS)) {
      const name = envName(target, suffix);
      const value = env[name];
      const reason = field === 'expectedRevision' ? revisionError(value) : urlError(value);
      if (reason) {
        targetConfig[field] = null;
        addFinding(findings, `target:${target}:${field.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}`, name, reason);
      } else targetConfig[field] = value.trim();
    }

    for (const provider of PROVIDERS) {
      const worker = {};
      const workerProblems = [];
      for (const [field, suffix] of Object.entries(WORKER_FIELDS)) {
        const name = envName(target, suffix, provider);
        const value = env[name];
        const reason = field === 'url' ? urlError(value) : requiredStringError(value);
        if (reason) {
          worker[field] = null;
          workerProblems.push(`${name} ${reason}`);
        } else {
          worker[field] = value.trim();
          const seen = workerValues.get(field) || new Map();
          const lane = `${target}:${provider}`;
          const owner = seen.get(worker[field]);
          if (owner) workerProblems.push(`${name} must be unique per target/provider lane (also configured for ${owner})`);
          else seen.set(worker[field], lane);
          workerValues.set(field, seen);
        }
      }
      targetConfig.workers[provider] = worker;
      if (workerProblems.length) {
        findings.push({
          id: `worker:${target}:${provider}`,
          status: 'blocked',
          required: true,
          evidence: workerProblems.join('; ') + '.',
        });
      }
    }
    targets[target] = targetConfig;
  }

  return { complete: findings.length === 0, targets, findings };
}

module.exports = {
  PROVIDERS,
  TARGETS,
  loadDemoReadinessRuntimeConfig,
};
