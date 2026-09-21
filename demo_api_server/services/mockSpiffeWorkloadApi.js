'use strict';

const spiffeTrustDomain = require('./spiffeTrustDomain');

const registrations = new Map();

function copyRegistration(registration) {
  return {
    workloadId: registration.workloadId,
    spiffeId: registration.spiffeId,
    selectors: { ...registration.selectors },
  };
}

function registerWorkload({ workloadId, spiffeId, selectors } = {}) {
  if (typeof workloadId !== 'string' || workloadId.length === 0) {
    throw new Error('workloadId is required');
  }
  if (!spiffeTrustDomain.isSpiffeId(spiffeId)) {
    throw new Error('spiffeId must be within the configured trust domain');
  }
  if (!selectors || typeof selectors !== 'object' || Array.isArray(selectors)
    || Object.keys(selectors).length === 0
    || Object.values(selectors).some((value) => value === undefined || value === null || value === '')) {
    throw new Error('selectors must be a non-empty object');
  }

  const registration = {
    workloadId,
    spiffeId,
    selectors: { ...selectors },
  };
  registrations.set(workloadId, registration);
  return copyRegistration(registration);
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
  const selectorKeys = Object.keys(registration.selectors);
  const contextKeys = Object.keys(context);
  const selectorsMatch = selectorKeys.length === contextKeys.length
    && selectorKeys.every((key) => Object.hasOwn(context, key)
      && context[key] === registration.selectors[key]);
  if (!selectorsMatch) {
    throw new Error(`selectors do not match registered workload ${workloadId}`);
  }

  return spiffeTrustDomain.issueSvid(registration.spiffeId, { audience });
}

function listRegistrations() {
  return [...registrations.values()].map(copyRegistration);
}

module.exports = {
  registerWorkload,
  clearRegistrations,
  issueJwtSvid,
  listRegistrations,
};
