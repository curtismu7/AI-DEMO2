'use strict';

/**
 * `a2aDelegatedScope` must stay out of the two riskLevel-driven enforcement paths.
 *
 * Background and the exact trap are in REGRESSION_PLAN.md §4 — not repeated here.
 * Short version: a `high` riskLevel on a specialist-only scope (pnr:read,
 * holdings:read) is inert ONLY because `a2aDelegatedScope` is a separate SoT
 * field that neither `agentScopes.resolveAgentScopes` nor
 * `agentRestrictionsService.getRequiredTier` reads — both go through
 * `requiredScopes`. Route the delegated scope into either one and every `high`
 * delegated scope becomes write-tier at once.
 *
 * These are outcome assertions, not structure assertions: they say what a user
 * gets (their tool, their token scopes), so they fail on the behaviour change
 * rather than on a refactor that moves the same logic somewhere else.
 */

const scopeTopology = require('../services/scopeTopology');
const { resolveAgentScopes } = require('../services/agentScopes');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');
const { verticalManifest } = require('../services/verticalManifest');

verticalManifest.init();

const manifest = scopeTopology._manifest();
const WRITE_RISK_LEVELS = new Set(['high', 'critical']);

/** [[toolName, delegatedScope]] for every tool carrying an a2aDelegatedScope. */
const DELEGATED_TOOLS = Object.entries(manifest.tools)
  .filter(([, def]) => def.a2aDelegatedScope)
  .map(([name, def]) => [name, def.a2aDelegatedScope]);

/**
 * Scopes reachable ONLY through a2aDelegatedScope — i.e. no tool lists them in
 * requiredScopes. These are minted at A2A Exchange #2 for the specialist and
 * must never be requested on the generalist's agent token; that narrowing is
 * what makes the chain un-fakeable.
 */
const SPECIALIST_ONLY_SCOPES = [...new Set(DELEGATED_TOOLS.map(([, s]) => s))]
  .filter((scope) => !Object.values(manifest.tools).some((d) => (d.requiredScopes || []).includes(scope)));

const VERTICALS = verticalManifest.list().map((v) => v.id);

test('the SoT still has A2A-delegated tools and at least one high-risk specialist-only scope', () => {
  // Guards the guard: if the fixtures vanish, the assertions below pass vacuously.
  expect(DELEGATED_TOOLS.length).toBeGreaterThan(0);
  expect(
    SPECIALIST_ONLY_SCOPES.filter((s) => WRITE_RISK_LEVELS.has(manifest.scopes[s]?.riskLevel)),
  ).not.toHaveLength(0);
});

describe('a2aDelegatedScope does not reach getRequiredTier', () => {
  test.each(DELEGATED_TOOLS)(
    '%s stays read-tier — a read-restricted user keeps it (delegated scope: %s)',
    (tool) => {
      const requiredScopes = manifest.tools[tool].requiredScopes || [];
      const anyWriteRequired = requiredScopes.some((s) => WRITE_RISK_LEVELS.has(manifest.scopes[s]?.riskLevel));
      if (anyWriteRequired) return; // genuinely write-tier from its OWN scopes

      const tier = getRequiredTier(tool);
      expect(tier).toBe('read');
      expect(isAgentRestricted('read', tier)).toBe(false);
    },
  );
});

describe('a2aDelegatedScope does not reach isWriteIsh via the agent token scope set', () => {
  // resolveAgentScopes is the only production caller of isWriteIsh, so a
  // delegated scope can only reach isWriteIsh by first entering this set.
  const cases = [];
  for (const vertical of VERTICALS) {
    for (const allowWrite of [false, true]) cases.push([vertical, allowWrite]);
  }

  test.each(cases)('%s (allowWrite=%s) requests no specialist-only scope', (vertical, allowWrite) => {
    const granted = resolveAgentScopes(vertical, allowWrite);
    for (const scope of SPECIALIST_ONLY_SCOPES) {
      expect(granted).not.toContain(scope);
    }
  });
});
