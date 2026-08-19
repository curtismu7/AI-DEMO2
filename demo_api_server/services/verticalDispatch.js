'use strict';

const { verticalManifest } = require('./verticalManifest');
const { specialistForVertical } = require('../config/a2aSpecialists');
const { ACCOUNT_NICKNAME_HEURISTIC } = require('../config/verticals/shared/bankingChipHeuristics');

/** Overlays with index.js but no manifest.json — not returned by loader.list(). */
const PLUGIN_OVERLAY_IDS = ['admin'];

/**
 * True when the A2A overlay should augment `activeId`: the active vertical has a
 * registered specialist. Generic across verticals (like the admin overlay, but
 * keyed on specialist registration rather than the admin role — A2A delegation
 * is a required subsystem, not a feature flag).
 * Note: 'a2a' is intentionally NOT in PLUGIN_OVERLAY_IDS — delegate_to_specialist is
 * intercepted by the agent loop, not delegated to MCP via isPluginToolName.
 */
function a2aActiveFor(activeId) {
  try {
    return !!specialistForVertical(activeId);
  } catch (_e) {
    return false;
  }
}

/**
 * Single seam between shared NL/agent code and per-vertical plugins.
 *
 * Each helper takes the active vertical id and a `legacy` callback. When the
 * active vertical has a plugin, the helper returns the plugin's value and the
 * legacy callback is NOT invoked. When there is no plugin, the presentation
 * helpers (heuristicsFor / systemPromptFor / toolSchemasFor) invoke `legacy`
 * and return its result.
 *
 * `executeToolFor` and `authzFor` do NOT: on the agent path the caller's legacy
 * is executeBffTool, which resolves names against BANKING's tool registry, so a
 * plugin-less vertical silently executed banking's tools (live: active vertical
 * admin-console ran get_my_transactions). Executing another vertical's tools —
 * or inheriting its authz — is never a valid substitute, so both fail explicitly
 * instead. See noPluginResult below.
 */

function resolvePlugin(activeId) {
  if (!activeId) return null;
  return verticalManifest.plugins.get(activeId);
}

function hasPlugin(activeId) {
  return resolvePlugin(activeId) !== null;
}

/**
 * Normalize a plugin tool to the MCP tool-schema shape.
 *
 * Plugin tools are LangChain `tool()` objects (see mcpToolRegistry.js) — their
 * parameter schema lives on `.schema` (a Zod object), not `.inputSchema` (that
 * property doesn't exist on LangChain tool instances). Reading `.inputSchema`
 * silently produced an empty `{ properties: {} }` schema for every plugin
 * tool, so the LLM received no declared parameters at all: it had to guess
 * argument names, which surfaced as "tool call validation failed" errors
 * (confirmed for create_deposit) once the model's guess didn't match the
 * name(s) the provider expected.
 */
function toToolSchema(t) {
  const inputSchema = t.inputSchema
    || (typeof t.schema?.toJSONSchema === 'function' ? t.schema.toJSONSchema() : null)
    || { type: 'object', properties: {} };
  return {
    name: t.name,
    description: t.description || '',
    inputSchema,
  };
}

/** Merge overlay tools onto base tools, overriding by name (overlay wins). */
function mergeToolsByName(tools, overlayTools) {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  overlayTools.forEach((t) => { toolMap.set(t.name, t); });
  return Array.from(toolMap.values());
}

function heuristicsFor(activeId, legacy, ctx = {}) {
  const p = resolvePlugin(activeId);
  let heuristics = p ? p.getHeuristics() : legacy();
  if (!Array.isArray(heuristics)) {
    heuristics = heuristics != null ? [heuristics] : [];
  }
  // Cross-vertical banking MCP chips — prepend on non-banking verticals so account
  // nickname wins over broad rules that match bare "account". Banking plugin keeps
  // its own ordered copy (before accounts) in config/verticals/banking/index.js.
  if (activeId && activeId !== 'banking') {
    heuristics = [ACCOUNT_NICKNAME_HEURISTIC, ...heuristics];
  }
  if (ctx?.isAdmin) {
    const adminOverlay = resolvePlugin('admin');
    if (adminOverlay && typeof adminOverlay.getHeuristics === 'function') {
      heuristics = [...heuristics, ...adminOverlay.getHeuristics()];
    }
  }
  if (a2aActiveFor(activeId)) {
    const a2aOverlay = resolvePlugin('a2a');
    if (a2aOverlay && typeof a2aOverlay.getHeuristics === 'function') {
      heuristics = [...heuristics, ...a2aOverlay.getHeuristics()];
    }
  }
  return heuristics;
}

function systemPromptFor(activeId, ctx, legacy) {
  const p = resolvePlugin(activeId);
  let prompt = p ? p.getSystemPrompt(ctx) : legacy(ctx);
  if (a2aActiveFor(activeId)) {
    const a2aOverlay = resolvePlugin('a2a');
    if (a2aOverlay && typeof a2aOverlay.getSystemPrompt === 'function') {
      const a2aPrompt = a2aOverlay.getSystemPrompt(ctx);
      if (a2aPrompt) prompt = `${prompt || ''}\n\n${a2aPrompt}`.trim();
    }
  }
  return prompt;
}

function toolSchemasFor(activeId, ctx, legacy) {
  const p = resolvePlugin(activeId);
  if (!p) return legacy();

  // heuristicOnly tools (e.g. banking's action aliases like 'transfer') are for
  // dispatchVerticalIntent name lookups only — never expose them as LLM-callable
  // functions, since the gateway's tool schema only recognizes the real tool names.
  const llmCallable = (t) => !t.heuristicOnly;

  let tools = p.getTools().filter(llmCallable).map(toToolSchema);

  // Merge admin overlay tools if user is admin (admin tools override vertical tools with same name)
  if (ctx?.isAdmin) {
    const adminOverlay = resolvePlugin('admin');
    if (adminOverlay) {
      tools = mergeToolsByName(tools, adminOverlay.getTools().filter(llmCallable).map(toToolSchema));
    }
  }

  // Merge the generic A2A overlay tool when active (flag on + vertical has a specialist).
  if (a2aActiveFor(activeId)) {
    const a2aOverlay = resolvePlugin('a2a');
    if (a2aOverlay && typeof a2aOverlay.getTools === 'function') {
      tools = mergeToolsByName(tools, a2aOverlay.getTools().filter(llmCallable).map(toToolSchema));
    }
  }

  return tools;
}

/**
 * Sentinel a vertical plugin returns from executeTool to say "this tool name is
 * not mine" — distinct from null, which plugins already use for other outcomes.
 */
const NOT_MY_TOOL = Symbol.for('verticalDispatch.NOT_MY_TOOL');

/**
 * Explicit "this vertical cannot run tools" result, in the shape of the
 * structured no-match introduced in PR #1214: it names the vertical that failed
 * and carries no other vertical's data. Returned instead of substituting the
 * caller's legacy executor, which on the agent path is banking's.
 */
function noPluginResult(activeId, name) {
  return {
    result: {
      error: `Vertical "${activeId || 'none'}" has no plugin, so tool "${name}" was not executed. No other vertical's tools are substituted.`,
      errorCode: 'vertical_no_plugin',
      verticalId: activeId || null,
      tool: name,
      noMatch: true,
    },
    render: 'text',
  };
}

async function executeToolFor(activeId, name, params, ctx, legacy) {
  const p = resolvePlugin(activeId);
  // No plugin: fail, do NOT fall through to `legacy`. Distinct from the
  // NOT_MY_TOOL fallthrough below — that is a plugin deliberately disowning a
  // tool name it advertises so the MCP executor can run it; this is a vertical
  // with no executor of its own, where legacy means "run banking's".
  if (!p) return noPluginResult(activeId, name);

  // First try the vertical's tools
  try {
    const out = await p.executeTool(name, params, ctx);
    // A plugin returns NOT_MY_TOOL to say "I do not own this name" — fall
    // through to the MCP executor instead of surfacing a local error. Banking
    // advertises the real MCP tool names (get_weather, explain_topic,
    // brave_search, get_login_activity) alongside its heuristic action aliases
    // but only ever dispatched the aliases, so those calls died as
    // "unknown banking action: <name>" while the MCP server that owns them was
    // never asked.
    //
    // Deliberately NOT null: dispatchBankingAction already returns null for its
    // own reasons (no user token, client-dispatched placeholder), and treating
    // that as "not my tool" would silently reroute unauthenticated core calls
    // into the MCP path. The sentinel means exactly one thing.
    if (out === NOT_MY_TOOL) return legacy(name, params, ctx);
    return out;
  } catch (e) {
    // If tool not found in vertical and user is admin, try admin overlay
    if (ctx?.isAdmin) {
      const adminOverlay = resolvePlugin('admin');
      if (adminOverlay) {
        try {
          return await adminOverlay.executeTool(name, params, ctx);
        } catch (adminErr) {
          return { result: { error: `tool "${name}" failed: ${adminErr.message}` }, render: 'text' };
        }
      }
    }
    return { result: { error: `tool "${name}" failed: ${e.message}` }, render: 'text' };
  }
}

function authzFor(activeId, ctx, legacy) {
  const p = resolvePlugin(activeId);
  // `legacy` is deliberately NOT called for a plugin-less vertical: authz rules
  // gate tool execution, and inheriting another vertical's rules is worse than
  // the data leak. A vertical with no plugin publishes no rules — and
  // executeToolFor refuses to run its tools anyway.
  let authz = p ? p.getAuthz() : {};

  // Merge admin overlay authz rules if user is admin
  if (ctx && ctx.isAdmin) {
    const adminOverlay = resolvePlugin('admin');
    if (adminOverlay) {
      authz = { ...authz, ...adminOverlay.getAuthz() };
    }
  }

  // Merge the A2A overlay authz (delegate_to_specialist has no BFF gate — Authorize decides).
  if (a2aActiveFor(activeId)) {
    const a2aOverlay = resolvePlugin('a2a');
    if (a2aOverlay && typeof a2aOverlay.getAuthz === 'function') {
      authz = { ...authz, ...a2aOverlay.getAuthz() };
    }
  }

  return authz;
}

/**
 * True when `name` is a vertical plugin action tool (healthcare, workforce, etc.)
 * registered for MCP delegation — not a banking LangChain registry tool.
 * @param {string} name
 * @returns {boolean}
 */
function isPluginToolName(name) {
  if (!name || typeof name !== 'string') return false;
  for (const overlayId of PLUGIN_OVERLAY_IDS) {
    const overlay = resolvePlugin(overlayId);
    if (overlay && typeof overlay.getTools === 'function') {
      if (overlay.getTools().some((t) => t.name === name)) return true;
    }
  }
  for (const v of verticalManifest.listAll()) {
    const id = v.id;
    if (id === 'banking' || PLUGIN_OVERLAY_IDS.includes(id)) continue;
    const p = resolvePlugin(id);
    if (!p || typeof p.getTools !== 'function') continue;
    if (p.getTools().some((t) => t.name === name)) return true;
  }
  return false;
}

/**
 * Find a vertical plugin that marks `name` as a pure-local tool (no MCP / authz /
 * token exchange). Used by executeBffTool so the LLM reason loop can call
 * teaching tools like oauth-teaching `explain_concept` without hitting the gateway.
 * @param {string} name
 * @returns {object|null} plugin with isLocalTool + executeTool, or null
 */
function findLocalToolPlugin(name) {
  if (!name || typeof name !== 'string') return null;
  // listAll() is empty until seeds are loaded (server boot calls init; tests may not).
  if (typeof verticalManifest.init === 'function') verticalManifest.init();
  const candidates = [];
  for (const overlayId of PLUGIN_OVERLAY_IDS) {
    candidates.push(resolvePlugin(overlayId));
  }
  for (const v of verticalManifest.listAll()) {
    const id = v.id;
    if (id === 'banking' || PLUGIN_OVERLAY_IDS.includes(id)) continue;
    candidates.push(resolvePlugin(id));
  }
  for (const p of candidates) {
    if (p && typeof p.isLocalTool === 'function' && p.isLocalTool(name) && typeof p.executeTool === 'function') {
      return p;
    }
  }
  return null;
}

module.exports = {
  NOT_MY_TOOL,
  resolvePlugin, hasPlugin,
  heuristicsFor, systemPromptFor, toolSchemasFor, executeToolFor, authzFor,
  isPluginToolName,
  findLocalToolPlugin,
  PLUGIN_OVERLAY_IDS,
};
