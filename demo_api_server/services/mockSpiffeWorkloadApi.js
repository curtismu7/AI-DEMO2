'use strict';

const spiffeTrustDomain = require('./spiffeTrustDomain');

const registrations = new Map();

function registerWorkload({ workloadId, spiffeId, selectors } = {}) {
  if (typeof workloadId !== 'string' || workloadId.length === 0) {
    throw new Error('workloadId is required');
  }
  if (!spiffeTrustDomain.isSpiffeId(spiffeId)) {
    throw new Error('spiffeId must be within the configured trust domain');
  }
  if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)
    || Object.keys(selectors).length === 0) {
    throw new Error('selectors must be a non-empty object');
  }

  registrations.set(workloadId, {
    workloadId,
    spiffeId,
    selectors: { ...selectors },
  });
}

function clearRegistrations() {
  registrations.clear();
}

function issueJwtSvid({ workloadId, selectorContext, audience } = {}) {
  const registration = registrations.get(workloadId);
  if (!registration) {
    throw new Error(`workload ${workloadId} is not registered`);
  }

  const context = selectorContext && typeof selectorContext === 'object'
    ? selectorContext
    : {};
  const selectorsMatch = Object.entries(registration.selectors)
    .every(([key, value]) => context[key] === value);
  if (!selectorsMatch) {
    throw new Error(`selectors do not match registered workload ${workloadId}`);
  }

  return spiffeTrustDomain.issueSvid(registration.spiffeId, { audience });
}

function listRegistrations() {
  return [...registrations.values()].map((registration) => ({
    workloadId: registration.workloadId,
    spiffeId: registration.spiffeId,
    selectors: { ...registration.selectors },
  }));
}

module.exports = {
  registerWorkload,
  clearRegistrations,
  issueJwtSvid,
  listRegistrations,
};
