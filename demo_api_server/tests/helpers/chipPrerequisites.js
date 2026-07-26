// demo_api_server/tests/helpers/chipPrerequisites.js
'use strict';

/**
 * Shared offline chip-prerequisite check for the per-vertical step-verification
 * suites. Ten suites carried a byte-identical copy of this block; seven were
 * exactly equal modulo the vertical name. That duplication is the same shape as
 * the requiredDemoFlags mirror drift, so it lives in one place now.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * Offline Jest has no access to the running stack's LMDB flag store, so the
 * check stubs every `ff_*` flag ON. That means a PASS here proves the catalog
 * DECLARES the right prerequisites — it says nothing about whether those flags
 * are ARMED in any environment. Every entry is stamped `flagsAssumedOn: true`
 * so the artifact cannot be misread as runtime evidence.
 *
 * That distinction is not academic: 202 all-PASS `unit-prereq` entries coexisted
 * with 22 of 50 banking use cases being dead at runtime because
 * ff_mcp_gateway_pinggateway / ff_gateway_brokered_exchange were never armed by
 * any code path. The ledger was green and the demo was broken.
 *
 * To stop the all-ON stub from making the check vacuous, every case is ALSO run
 * with the flags forced OFF and asserted to be detected — that exercises the
 * real branch in checkChipPrerequisites instead of only the happy one.
 */

const { USE_CASES, resolveUseCase } = require('../../config/useCases.js');
const { writeLedgerEntry } = require('../../services/stepVerificationLedger');

// NOTE: this module deliberately does NOT require configStore itself. Every
// suite calls jest.mock('../services/configStore', ...) and keeps the real one
// as jest.requireActual(...). A plain require here resolves to the MOCK, which
// knows nothing about PAR / CIBA config, so prerequisites that read non-flag
// keys silently reported "missing". The caller passes its own store instead.

const CHIP_PREREQ_MODE = 'unit-prereq';

/**
 * Free-form LLM-analysis use cases: the LLM reasons over live data and picks
 * its own tools, so the catalog carries `primaryTool: null` deliberately.
 * Mirrors LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js and
 * useCases.verticalChipCoverage.test.js — keep the three in step.
 */
const LLM_ANALYSIS_UNROUTABLE = new Set(['UC34', 'UC35']);

/**
 * Use cases in a vertical that carry an offline prerequisite expectation:
 * runnable maturity, and either a chip trigger or a PAR-dependent trigger.
 * @param {string} vertical
 * @returns {object[]} resolved catalog entries
 */
function chipPrerequisiteCases(vertical) {
  // Required lazily: jest setup.js calls resetModules(), so a top-level require
  // of demoStepPrerequisites would not share identity with a suite's mock.
  const { needsParConfig } = require('../../services/demoStepPrerequisites');
  const out = [];
  const seen = new Set();
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, vertical) || u;
    const mat = uc.maturity || '';
    if (mat !== 'works' && !String(mat).startsWith('flag:')) continue;
    const t = uc.trigger || {};
    const isChip = t.type === 'chip' && t.text;
    if (!isChip && !needsParConfig(uc)) continue;
    if (seen.has(uc.id)) continue;
    seen.add(uc.id);
    out.push(uc);
  }
  return out;
}

/**
 * configStore-like stub that pins every declared feature flag and defers the
 * rest to the real store.
 *
 * `pinned` is the use case's own requiredFlags, not a name prefix: flag ids are
 * not all `ff_*`-prefixed (ciba_enabled is the counter-example), and a prefix
 * test silently failed to pin those — making the ON case report them as off.
 */
function flagStub(pinned, value, realConfigStore) {
  const pinnedSet = new Set(pinned);
  return {
    getEffective: (k) => {
      if (pinnedSet.has(k)) return value;
      if (typeof k === 'string' && k.startsWith('ff_')) return value;
      return realConfigStore.getEffective(k);
    },
  };
}

/**
 * Run the offline prerequisite check for one use case and record it honestly.
 *
 * @param {object} uc resolved catalog entry
 * @param {string} vertical
 * @param {{ getEffective: (k: string) => * }} realConfigStore the suite's
 *   jest.requireActual('../services/configStore') — NOT the jest mock.
 * @returns {{
 *   requiredFlags: string[],
 *   prereq: object,          // flags assumed ON  — the recorded verdict
 *   prereqFlagsOff: object,  // flags forced OFF  — the negative control
 *   flagsOffDetected: string[],
 *   claimsToolDispatch: boolean,
 *   ledgerPath: string,
 * }}
 */
function runChipPrerequisiteCheck(uc, vertical, realConfigStore) {
  const {
    requiredFlagsForUseCase,
    checkChipPrerequisites,
  } = require('../../services/demoStepPrerequisites');

  const requiredFlags = requiredFlagsForUseCase(uc);
  const prereq = checkChipPrerequisites(
    uc, vertical, flagStub(requiredFlags, true, realConfigStore));
  const prereqFlagsOff = checkChipPrerequisites(
    uc, vertical, flagStub(requiredFlags, false, realConfigStore));

  // Which of the declared flags the check actually noticed were off. If this
  // does not match requiredFlags, the prereq logic is not really testing flags.
  const flagsOffDetected = requiredFlags.filter((f) =>
    prereqFlagsOff.errors.some((e) => e.includes(f)),
  );

  // Evidence steps a CHIP can only produce by dispatching its primaryTool.
  // `authorize-decision` counts for chips: the Authorize gate runs on the tool
  // call, so a chip that dispatches nothing can never produce one.
  //
  // Scoped to chips deliberately. `attack` triggers run through
  // /api/demo/attack-sim/run and `link` triggers navigate — both can emit
  // authorize evidence with no primaryTool, so this invariant does not apply
  // to them. (Whether an attack sim emits the step id its catalog entry claims
  // is a separate defect — sims emit `sim-*` ids — and belongs to the sweep.)
  //
  // Free-form LLM-analysis use cases are exempt for a different reason: they
  // dispatch tools the LLM chooses at runtime, so the catalog legitimately
  // cannot name a primaryTool in advance, yet the run still produces dispatch
  // evidence. Same set the routing gates already skip (LLM_ANALYSIS_UNROUTABLE
  // in useCases.primaryTool.test.js and useCases.verticalChipCoverage.test.js).
  const tokenChain = (uc.evidence && uc.evidence.tokenChain) || [];
  const isChip = (uc.trigger || {}).type === 'chip';
  const dispatchOnlyEvidence = isChip && !LLM_ANALYSIS_UNROUTABLE.has(uc.id)
    ? tokenChain.filter((s) => s === 'tool-dispatched' || s === 'authorize-decision')
    : [];
  const claimsToolDispatch = dispatchOnlyEvidence.length > 0;

  const t = uc.trigger || {};
  const triggerType = t.type === 'chip' ? 'chip' : (t.type || 'chip');

  const ledgerPath = writeLedgerEntry({
    vertical,
    useCaseId: uc.id,
    triggerType,
    mode: CHIP_PREREQ_MODE,
    status: prereq.ok ? 'PASS' : 'FAIL',
    errorClass: prereq.ok ? null : 'missing_prereq',
    primaryTool: uc.primaryTool || null,
    checkedAt: new Date().toISOString(),
    requiredFlags,
    prereqErrors: prereq.errors.length ? prereq.errors : undefined,
    // Truth-in-labelling. Read these before treating a PASS as runtime evidence.
    flagsAssumedOn: true,
    provesDeclaredOnly: true,
    flagsOffDetected,
  });

  return {
    requiredFlags,
    prereq,
    prereqFlagsOff,
    flagsOffDetected,
    claimsToolDispatch,
    dispatchOnlyEvidence,
    ledgerPath,
  };
}

/**
 * Assertions every vertical shares. Kept here so a new vertical suite cannot
 * accidentally assert less than the others.
 *
 * @param {object} uc resolved catalog entry
 * @param {ReturnType<typeof runChipPrerequisiteCheck>} result
 */
function assertSharedChipPrerequisites(uc, result) {
  const { requiredFlags, flagsOffDetected, claimsToolDispatch, dispatchOnlyEvidence } = result;

  // A chip whose evidence claims a dispatch-only step must name the tool it
  // dispatches, or that evidence can never be produced and the row is
  // unfalsifiable — it can only ever score "incomplete", never prove anything.
  // (This is what the old blunt `requiredFlags.length > 0` assertion was
  // failing on for UC34/UC35 without ever saying why.)
  if (claimsToolDispatch && !uc.primaryTool) {
    throw new Error(
      `${uc.id} declares evidence.tokenChain [${dispatchOnlyEvidence.join(', ')}] `
      + 'but primaryTool is null — it dispatches nothing, so that evidence can never '
      + 'appear and the use case can only ever score incomplete. Fix the catalog: '
      + 'give it a primaryTool, or drop those steps from its evidence.',
    );
  }

  // Any use case that dispatches a tool needs the gateway runtime flags.
  if (uc.primaryTool) {
    const { MCP_GATEWAY_RUNTIME_FLAGS } = require('../../services/demoStepPrerequisites');
    expect(requiredFlags).toEqual(expect.arrayContaining(MCP_GATEWAY_RUNTIME_FLAGS));
  }

  // The negative control: with the flags off, the check must notice every one
  // of them. Without this the all-ON stub makes the whole case vacuous.
  expect(flagsOffDetected.sort()).toEqual([...requiredFlags].sort());
}

module.exports = {
  CHIP_PREREQ_MODE,
  LLM_ANALYSIS_UNROUTABLE,
  chipPrerequisiteCases,
  runChipPrerequisiteCheck,
  assertSharedChipPrerequisites,
};
