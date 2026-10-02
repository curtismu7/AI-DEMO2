'use strict';

// Readiness audit rows answered from this process and this checkout rather than
// from a provider API: the BFF's effective configuration (flags, A2A
// credentials, PAR settings) and the tool-scope copy PingGateway mounts.
//
// The effective configuration lives in the BFF's config store, which only the
// BFF process has loaded. A caller outside it (the command-line runner) passes
// no store and gets `blocked`, never a guess: a second process reading the
// store sees it empty, which would read as "nothing is configured".

const fs = require('node:fs');
const path = require('node:path');
const { resolveRepositoryRoot } = require('../utils/repositoryRoot');

const IN_PROCESS_ONLY = ' is readable only inside the BFF process; run from Admin sidebar Reset Demo';
const sorted = (values) => [...(values || [])].sort();

/**
 * A2A credential and PAR setting NAMES that a vertical/use case needs and the
 * store does not hold. Presence only — a value is never read out.
 */
function missingCaseConfiguration({ a2a, par, verticals }, configStore) {
  const { checkA2aCredentials, checkParConfig } = require('./demoStepPrerequisites');
  const missing = par ? [...checkParConfig(configStore).missing] : [];
  if (a2a) {
    for (const vertical of verticals) {
      const credentials = checkA2aCredentials(vertical, configStore);
      if (credentials.required && !credentials.ok) missing.push(vertical + ': ' + credentials.clientIdKey + ' / ' + credentials.clientSecretKey);
    }
  }
  return missing;
}

/** The `pingone:requiredFlag`, `a2aCredential` and `parSetting` rows. */
function effectiveConfigValues(configStore) {
  if (!configStore) {
    return {
      requiredFlag: { status: 'blocked', reason: 'effective feature-flag configuration' + IN_PROCESS_ONLY },
      a2aCredential: { status: 'blocked', reason: 'A2A specialist credential presence' + IN_PROCESS_ONLY },
      parSetting: { status: 'blocked', reason: 'PAR setting presence' + IN_PROCESS_ONLY },
    };
  }
  const { buildDemoReadinessCatalog, loadDemoReadinessSources } = require('./demoReadinessCatalog');
  const { requiredFlagsForUseCase, isFlagOn } = require('./demoStepPrerequisites');
  const sources = loadDemoReadinessSources();
  const flags = [...new Set(buildDemoReadinessCatalog().flatMap((entry) => (
    requiredFlagsForUseCase(sources.useCases.find((candidate) => candidate.id === entry.id) || {})
  )))].sort();
  // A required flag must RESOLVE: one the store does not know cannot be armed.
  // Off is not a failure — a run arms what its step needs and restores it.
  const unresolved = flags.filter((flag) => [undefined, null, ''].includes(configStore.getEffective(flag)));
  const verticals = Object.keys(sources.verticalManifests || {});
  const a2aMissing = missingCaseConfiguration({ a2a: true, verticals }, configStore);
  const parMissing = missingCaseConfiguration({ par: true, verticals }, configStore);
  return {
    requiredFlag: { status: unresolved.length ? 'fail' : 'pass', observed: { required: flags, unresolved, off: flags.filter((flag) => !isFlagOn(configStore.getEffective(flag))) } },
    a2aCredential: { status: a2aMissing.length ? 'fail' : 'pass', observed: { missing: a2aMissing } },
    parSetting: { status: parMissing.length ? 'fail' : 'pass', observed: { missing: parMissing } },
  };
}

/**
 * `pingone:registeredToolScope`: every tool in scope-topology.json must carry
 * the same required scopes in ping-gateway/config/scope-topology.json — the
 * separately tracked copy PingGateway mounts and enforces from. A tool missing
 * there skips the gateway's scope backstop, and `topology:verify` does not
 * open that file.
 */
function toolScopeParity(root = resolveRepositoryRoot(__dirname)) {
  const tools = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).tools || {};
  const declared = tools('scope-topology.json');
  const mounted = tools('ping-gateway/config/scope-topology.json');
  const differing = Object.keys(declared).filter((name) => (
    JSON.stringify(sorted(declared[name].requiredScopes)) !== JSON.stringify(sorted(mounted[name]?.requiredScopes))
    || !(name in mounted)
  ));
  const unknown = Object.keys(mounted).filter((name) => !(name in declared));
  return {
    status: differing.length || unknown.length ? 'fail' : 'pass',
    observed: { tools: Object.keys(declared).length, differing, unknownToRoot: unknown },
  };
}

module.exports = { effectiveConfigValues, missingCaseConfiguration, toolScopeParity, IN_PROCESS_ONLY };
