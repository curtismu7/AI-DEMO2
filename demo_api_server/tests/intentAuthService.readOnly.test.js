'use strict';

/**
 * Drift guard: every vertical's UC1 primary read intent must be consent-free.
 *
 * The read-only allowlist in intentAuthService was hand-maintained and went
 * stale when government/university/manufacturing/investment shipped — their
 * UC1 read chips fell through to the conservative-consent fallback, so
 * /api/agent/invoke answered 428 and the UI rendered "That step couldn't be
 * completed." Deriving the expectation from useCases keeps a new vertical from
 * repeating it.
 */

jest.mock('../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../services/appEventService', () => ({ logEvent: () => {} }));
jest.mock('../services/intentRiskScorer', () => ({
  evaluateRiskAndAuthority: async () => ({ riskScore: 0.7, authorityScore: undefined }),
}));

const { evaluateIntentAuthorization } = require('../services/intentAuthService');
const {
  READ_PRIMARY_TOOL_BY_VERTICAL,
  A2A_PRIMARY_TOOL_BY_VERTICAL,
} = require('../config/useCases');
const { extractIntentAndConfidence } = require('../services/nlIntentParser');
const { verticalManifest } = require('../services/verticalManifest');

// 0.85 is what the heuristic parser emits for a UC1/UC2 chip, and it is NOT
// > 0.85, so the three-dimension permit branch can never carry these — without
// the read-only allowlist they all land on the conservative-consent fallback.
const CHIP_CONFIDENCE = 0.85;

async function decide(intent) {
  return evaluateIntentAuthorization({
    intent,
    confidence: CHIP_CONFIDENCE,
    toolName: intent,
    userId: 'test-user',
  });
}

describe('intentAuthService — UC1 read intents never require HITL consent', () => {
  const cases = [['banking', 'view_balance'], ...Object.entries(READ_PRIMARY_TOOL_BY_VERTICAL)];

  test.each(cases)('%s: %s is permitted without consent', async (vertical, intent) => {
    const decision = await decide(intent);
    expect(decision.authorized).toBe(true);
    expect(decision.requires_consent).toBe(false);
  });
});

describe('intentAuthService — UC2 sensitive reads defer consent to the downstream gate', () => {
  // Consent for these is owned by the tool's own `authz: { consent: true }` and
  // by the PingOne Authorize decision, both of which return a renderable
  // hitl_required moment. A bare 428 here pre-empts them and dead-ends the chip.
  test.each(Object.entries(A2A_PRIMARY_TOOL_BY_VERTICAL))(
    '%s: %s is not consent-gated by intentAuthService',
    async (vertical, intent) => {
      const decision = await decide(intent);
      expect(decision.authorized).toBe(true);
      expect(decision.requires_consent).toBe(false);
    },
  );
});

/**
 * The two maps above only list the verticals that OPTED IN to a per-vertical
 * use-case override — airlines is in neither, so nothing above sees it. This
 * block walks every vertical's real read chips instead, so vertical eleven is
 * covered the day it ships without anyone remembering to add it here.
 *
 * It drives the ACTUAL pre-execution path agentInvokeRoute takes:
 *   extractIntentAndConfidence(chip.message) -> if intent !== 'unknown'
 *   -> evaluateIntentAuthorization  -> requires_consent === true means HTTP 428.
 * Asserting on the tool NAME instead would prove nothing: READ_ONLY_INTENTS is
 * keyed on the parser's intent LABEL, which is rarely the tool name.
 */
verticalManifest.init();

// Banking is excluded for the same reason scripts/gen-vertical-tools.js excludes
// it: its plugin catalog ships heuristic action aliases with no scopes/authz
// metadata, so every entry would misclassify as a read tool. Banking's read
// intents are covered by the hardcoded case in the first describe block.
const ALIAS_CATALOG_VERTICALS = new Set(['banking']);

const isWriteScope = (scopes) => scopes.some((s) => s === 'write' || /:(write|delete|manage)$/.test(s));

/** [[vertical, chipId, tool, message]] for every chip backed by a plain read tool. */
function enumerateReadChips() {
  const out = [];
  for (const summary of verticalManifest.list()) {
    if (ALIAS_CATALOG_VERTICALS.has(summary.id)) continue;
    const plugin = verticalManifest.plugins.get(summary.id);
    if (!plugin || typeof plugin.getTools !== 'function') continue;

    // A "read chip" is one whose tool the vertical itself declares read-scoped
    // with no consent/step-up gate. Consent and step-up tools are deliberately
    // left out — their challenge is owned downstream, not by this service.
    const readTools = new Set(
      plugin.getTools()
        .filter((t) => {
          const scopes = Array.isArray(t.scopes) && t.scopes.length ? t.scopes : ['read'];
          const authz = t.authz || {};
          return !isWriteScope(scopes) && !authz.consent && !authz.stepUp;
        })
        .map((t) => t.name),
    );

    const loaded = verticalManifest.loader.get(summary.id);
    const manifest = loaded && (loaded.manifest || loaded);
    for (const chip of (manifest?.dashboard?.chips10 || [])) {
      if (!chip || !chip.tool || !chip.message || !readTools.has(chip.tool)) continue;
      out.push([summary.id, chip.id, chip.tool, chip.message]);
    }
  }
  return out;
}

describe('intentAuthService — no vertical read chip is consent-gated (manifest-derived)', () => {
  const readChips = enumerateReadChips();

  test('the walk found read chips in every plugin vertical', () => {
    expect(readChips.length).toBeGreaterThan(20);
  });

  test.each(readChips)('%s/%s (%s) does not 428 on "%s"', async (vertical, chipId, tool, message) => {
    const { intent, confidence } = extractIntentAndConfidence(message);
    // 'unknown' short-circuits the gate in agentInvokeRoute — nothing to assert,
    // and this is exactly the state airlines' read chips are in today.
    if (intent === 'unknown') return;
    const decision = await evaluateIntentAuthorization({ intent, confidence, toolName: tool });
    expect(decision.authorized).toBe(true);
    expect(decision.requires_consent).toBe(false);
  });
});
