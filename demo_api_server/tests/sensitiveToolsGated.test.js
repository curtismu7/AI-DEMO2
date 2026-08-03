'use strict';

/**
 * Every `sensitive_*` tool a vertical ships MUST be group-gated.
 *
 * The tool list is ENUMERATED from the verticals themselves, never hardcoded — a
 * tenth vertical that ships a sensitive tool without a `groups.restrictedTools`
 * entry fails here instead of shipping ungated. That is the whole point of this
 * suite; do not replace the walk with a literal array.
 */

const { verticalManifest } = require('../services/verticalManifest');
const groupPolicy = require('../services/groupPolicy');
const simulatedAuthorize = require('../services/simulatedAuthorizeService');

verticalManifest.init();

/** Keys whose string value names an MCP tool in a vertical manifest. */
const TOOL_KEYS = new Set(['tool', 'mcpTool', 'toolName']);
const SENSITIVE_NAME = /sensitive/i;

/**
 * Verticals whose plugin catalog advertises heuristic ACTION ALIASES rather than
 * MCP tool names. Banking's plugin ships `sensitive_account_details`, which every
 * dispatch path rewrites to the real MCP tool `get_sensitive_account_details`
 * (config/verticals/banking/index.js TOOL_NAME_TO_ACTION) before authorization —
 * so the alias never reaches mcpToolAuthorizationService and is not a gate target.
 * scripts/gen-vertical-tools.js excludes banking from its own catalog walk for the
 * same reason. Banking is still covered here via its manifest chip.
 */
const ALIAS_CATALOG_VERTICALS = new Set(['banking']);

/** Recursively collect tool-key values matching the `sensitive` naming convention. */
function collectManifestToolNames(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectManifestToolNames(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (TOOL_KEYS.has(key) && typeof value === 'string' && SENSITIVE_NAME.test(value)) {
        out.add(value);
      }
      collectManifestToolNames(value, out);
    }
  }
  return out;
}

/**
 * [{ verticalId, tool }] for every authorization-visible `sensitive_*` tool.
 *
 * Union of two data sources, because neither alone covers all ten verticals:
 *  - the plugin tool catalog (`config/verticals/<id>/tools.js` via getTools()) —
 *    retail, sporting-goods and workforce ship a sensitive tool no chip dispatches;
 *  - manifest `tool` / `mcpTool` declarations — the only place banking's real MCP
 *    tool name appears.
 */
function enumerateSensitiveTools() {
  const seen = new Map();
  for (const summary of verticalManifest.list()) {
    const add = (name) => seen.set(`${summary.id}:${name}`, { verticalId: summary.id, tool: name });

    if (!ALIAS_CATALOG_VERTICALS.has(summary.id)) {
      const plugin = verticalManifest.plugins.get(summary.id);
      if (plugin && typeof plugin.getTools === 'function') {
        for (const tool of plugin.getTools()) {
          if (tool && typeof tool.name === 'string' && SENSITIVE_NAME.test(tool.name)) add(tool.name);
        }
      }
    }

    const manifest = verticalManifest.resolver.resolve(summary.id);
    if (manifest) {
      for (const name of collectManifestToolNames(manifest, new Set())) add(name);
    }
  }
  return [...seen.values()];
}

describe('sensitive tools are group-gated in every vertical', () => {

  beforeEach(() => {
    groupPolicy._reset();
  });

  const sensitiveTools = enumerateSensitiveTools();

  it('finds a sensitive tool in all ten data verticals', () => {
    const verticals = [...new Set(sensitiveTools.map((r) => r.verticalId))].sort();
    expect(verticals).toEqual([
      'airlines',
      'banking',
      'government',
      'healthcare',
      'investment',
      'manufacturing',
      'retail',
      'sporting-goods',
      'university',
      'workforce',
    ]);
  });

  it.each(sensitiveTools)(
    '$verticalId/$tool resolves to a required PingOne group',
    ({ verticalId, tool }) => {
      expect(groupPolicy.requiredGroupForTool(tool, verticalId)).toEqual(expect.any(String));
    },
  );

  it.each(sensitiveTools)(
    '$verticalId/$tool denies a user with no group membership',
    ({ verticalId, tool }) => {
      const requiredGroup = groupPolicy.requiredGroupForTool(tool, verticalId);
      const userGroups = groupPolicy.groupsForUserSync('demoDelegate', verticalId);
      expect(userGroups).not.toContain(requiredGroup);
    },
  );

  it.each(sensitiveTools)(
    '$verticalId/$tool permits demoUser, who is in the privileged group',
    ({ verticalId, tool }) => {
      const requiredGroup = groupPolicy.requiredGroupForTool(tool, verticalId);
      expect(groupPolicy.groupsForUserSync('demoUser', verticalId)).toContain(requiredGroup);
    },
  );

  /**
   * The manifest block is only worth adding if it produces a real DENY. This
   * drives the actual decision engine, not the accessors.
   *
   * BASE satisfies the two guards that run BEFORE the group guard: the a2a
   * delegation guard (needs act depth >= 2 via nestedActClientId) and the
   * audience guard (skipped when mcpResourceUri is absent). Without them every
   * case denies for an unrelated reason and the assertion proves nothing.
   */
  const BASE = { userId: 'u-123', actClientId: 'specialist', nestedActClientId: 'generalist' };

  it.each(sensitiveTools)(
    '$verticalId/$tool DENIES user_not_in_group with the flag ON',
    async ({ verticalId, tool }) => {
      const requiredGroup = groupPolicy.requiredGroupForTool(tool, verticalId);
      const res = await simulatedAuthorize.evaluateMcpFirstTool({
        ...BASE, toolName: tool, verticalId, requiredGroup, userGroups: [],
      });
      expect(res.decision).toBe('DENY');
      expect(res.raw.deny_reason).toBe('user_not_in_group');
    },
  );

  it.each(sensitiveTools)(
    '$verticalId/$tool does NOT deny on group membership with the flag OFF',
    async ({ verticalId, tool }) => {
      // Flag off → mcpToolAuthorizationService leaves both null, guard is a no-op.
      const res = await simulatedAuthorize.evaluateMcpFirstTool({
        ...BASE, toolName: tool, verticalId, requiredGroup: null, userGroups: null,
      });
      expect(res.raw.deny_reason).not.toBe('user_not_in_group');
    },
  );

  it.each(sensitiveTools)(
    '$verticalId/$tool clears the group guard for a privileged member',
    async ({ verticalId, tool }) => {
      const requiredGroup = groupPolicy.requiredGroupForTool(tool, verticalId);
      const res = await simulatedAuthorize.evaluateMcpFirstTool({
        ...BASE, toolName: tool, verticalId, requiredGroup, userGroups: [requiredGroup],
      });
      expect(res.raw.deny_reason).not.toBe('user_not_in_group');
    },
  );

  it('declares every restricted tool group in categories, so provisioning can create it', () => {
    const defs = groupPolicy.listAllVerticalGroupDefinitions();
    const gatedVerticals = new Set(sensitiveTools.map((r) => r.verticalId));
    for (const def of defs) {
      if (!gatedVerticals.has(def.verticalId)) continue;
      for (const [tool, categoryKey] of Object.entries(def.restrictedTools)) {
        expect(`${def.verticalId}:${tool}:${categoryKey}`)
          .toBe(`${def.verticalId}:${tool}:${def.categories[categoryKey] ? categoryKey : 'MISSING'}`);
        expect(def.categories[categoryKey].name).toEqual(expect.any(String));
      }
    }
  });
});
