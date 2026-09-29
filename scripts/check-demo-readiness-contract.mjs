#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { DEMO_PRIMARY_USE_CASE_IDS, DEMO_ADVANCED_USE_CASE_IDS, CIAM_AGENT_TYPE_USE_CASE_IDS, PRIVILEGE_USE_CASE_IDS, ADMIN_PRIMARY_USE_CASE_IDS } from '../demo_api_ui/src/config/demoUseCaseSteps.js';
import { EDU } from '../demo_api_ui/src/components/education/educationIds.js';
import { requiredFlagsForUseCase as uiRequiredFlagsForUseCase } from '../demo_api_ui/src/utils/requiredDemoFlags.js';

const require = createRequire(import.meta.url);
const {
  loadDemoReadinessSources,
  validateDemoReadinessCatalog,
} = require('../demo_api_server/services/demoReadinessCatalog');
const { resolveUseCase } = require('../demo_api_server/config/useCases');
const { requiredFlagsForUseCase: bffRequiredFlagsForUseCase } = require('../demo_api_server/services/demoStepPrerequisites');

function checkDemoReadinessContract() {
  const sources = loadDemoReadinessSources();
  const uiInventory = {
    primary: DEMO_PRIMARY_USE_CASE_IDS,
    advanced: DEMO_ADVANCED_USE_CASE_IDS,
    ciam: CIAM_AGENT_TYPE_USE_CASE_IDS,
    privilege: PRIVILEGE_USE_CASE_IDS,
    admin: ADMIN_PRIMARY_USE_CASE_IDS,
  };
  const rows = validateDemoReadinessCatalog(sources, {
    uiInventory,
    educationPanelIds: Object.values(EDU),
  });
  const unclassified = rows.filter((row) => !row.repairability || row.repairability.sourceCodeChanges !== 'never');
  if (unclassified.length) {
    throw new Error(`Unclassified configuration-only repair behavior: ${unclassified.map((row) => row.id).join(', ')}`);
  }
  const prerequisiteMismatches = [];
  for (const row of rows.filter((candidate) => candidate.kind === 'demo-step')) {
    for (const vertical of row.verticals) {
      const useCase = resolveUseCase(row.id, vertical);
      const uiFlags = uiRequiredFlagsForUseCase(useCase).sort();
      const bffFlags = bffRequiredFlagsForUseCase(useCase).sort();
      const catalogFlags = row.runtimePrerequisitesByVertical[vertical]?.requiredFlags || [];
      if (new Set(uiFlags).size !== uiFlags.length || JSON.stringify(uiFlags) !== JSON.stringify(bffFlags)) {
        prerequisiteMismatches.push(`${row.id}/${vertical}: UI flags [${uiFlags.join(', ')}], BFF flags [${bffFlags.join(', ')}]`);
      }
      if (JSON.stringify(bffFlags) !== JSON.stringify([...catalogFlags].sort())) {
        prerequisiteMismatches.push(`${row.id}/${vertical}: readiness catalog flags [${catalogFlags.join(', ')}], BFF flags [${bffFlags.join(', ')}]`);
      }
    }
  }
  if (prerequisiteMismatches.length) {
    throw new Error(`UI/BFF/readiness prerequisites drifted:\n- ${prerequisiteMismatches.join('\n- ')}`);
  }
  const projectRoot = new URL('../', import.meta.url);
  const missingFeatureSources = sources.featureChecks.checks.filter((check) => {
    try {
      readFileSync(new URL(check.sourceRef, projectRoot), 'utf8');
      return false;
    } catch {
      return true;
    }
  });
  const isTestFile = (sourceRef) => {
    const sourcePath = String(sourceRef || '').split('#', 1)[0];
    return sourcePath.includes('/__tests__/') || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourcePath);
  };
  const featureTestRefs = sources.featureChecks.checks.flatMap((check) => [
    ...(isTestFile(check.sourceRef) ? [{ id: check.id, sourceRef: check.sourceRef, testTitle: check.testTitle }] : []),
    ...(check.relatedTests || []).map((test) => ({ id: check.id, ...test })),
  ]);
  const missingFeatureTests = featureTestRefs.filter((test) => {
    try {
      return !readFileSync(new URL(test.sourceRef, projectRoot), 'utf8').includes(test.testTitle);
    } catch {
      return true;
    }
  });
  if (missingFeatureSources.length) {
    throw new Error(`Feature-check source files are missing: ${missingFeatureSources.map((check) => `${check.id} (${check.sourceRef})`).join(', ')}`);
  }
  if (missingFeatureTests.length) {
    throw new Error(`Feature-check test references are missing or stale: ${missingFeatureTests.map((test) => `${test.id} (${test.sourceRef})`).join(', ')}`);
  }
  return rows;
}

try {
  const rows = checkDemoReadinessContract();
  console.log(
    `Demo readiness contract passed: ${rows.length} executable Demo Steps entries `
    + '(24 primary, 4 CIAM, 6 Privilege, 12 Admin).',
  );
  const sources = loadDemoReadinessSources();
  console.log(`${sources.featureChecks.checks.length} provider feature checks are registered separately from the 46 UI entries`);
  console.log('UI, BFF, and readiness prerequisite flags match for every case and vertical.');
  console.log(
    `Provider flows: ${Object.keys(sources.repairability.providerFlows).length}; `
    + `repairability classes: ${Object.keys(sources.repairability.driftClasses).length} drift, `
    + `${Object.keys(sources.repairability.executionModes).length} handler.`,
  );
  const runtimeGroups = rows.reduce((total, row) => total + row.runtimeVerticalGroups.length, 0);
  const coreRows = rows.reduce((total, row) => total + row.runtimeVerticalGroups.reduce(
    (rowTotal) => rowTotal + (row.id === 'UC40' ? 2 : 4),
    0,
  ), 0);
  const alternateRows = rows.reduce((total, row) => total + row.alternateBehaviors.length * 4, 0);
  const featureRows = sources.featureChecks.checks.reduce(
    (total, check) => total + check.providers.length * 2,
    0,
  );
  console.log(
    `Derived matrix: ${runtimeGroups} behavior/authorization groups; ${coreRows} core rows; `
    + `${alternateRows} alternate-behavior rows; ${featureRows} registered provider-feature rows; `
    + `${coreRows + alternateRows + featureRows} current rows.`,
  );
} catch (error) {
  console.error(error.message || String(error));
  process.exitCode = 1;
}
