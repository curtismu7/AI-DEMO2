'use strict';

const { verticalManifest } = require('./verticalManifest');
const { isA2aEnabled } = require('./a2aDelegationService');
const { specialistForVertical } = require('../config/a2aSpecialists');

/** Overlays with index.js but no manifest.json — not returned by loader.list(). */
const PLUGIN_OVERLAY_IDS = ['admin'];

/**
 * True when the A2A overlay should augment `activeId`: the feature flag is on AND
 * the active vertical has a registered specialist. Generic across verticals (like
 * the admin overlay, but gated by ff_a2a_delegation rather than the admin role).
 * Note: 'a2a' is intentionally NOT in PLUGIN_OVERLAY_IDS — delegate_to_specialist is
 * intercepted by the agent loop, not delegated to MCP via isPluginToolName.
 */
function a2aActiveFor(activeId) {
  try {
    return isA2aEnabled() && !!specialistForVertical(activeId);
  } catch (_e) {
    return false;
  }
}

/**
 * Single seam between shared NL/agent code and per-vertical plugins.
 *
 * Each helper takes the active vertical id and a `legacy` callback. When the
 * active vertical has a plugin, the helper returns the plugin's value and the
 * legacy callback is NOT invoked. When there is no plugin, the helper invokes
 * `legacy` and returns its result. This module never produces banking/default
 * content itself — the only fallback is the caller's own legacy path, used
 * solely while a vertical has not yet shipped its index.js.
 */

function resolvePlugin(activeId) {
  if (!activeId) return null;
  return verticalManifest.plugins.get(activeId);
}

function hasPlugin(activeId) {
  return resolvePlugin(activeId) !== null;
}

/** Normalize a plugin tool to the MCP tool-schema shape. */
function toToolSchema(t) {
  return {
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
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

  let tools = p.getTools().map(toToolSchema);

  // Merge admin overlay tools if user is admin (admin tools override vertical tools with same name)
  if (ctx?.isAdmin) {
    const adminOverlay = resolvePlugin('admin');
    if (adminOverlay) {
      tools = mergeToolsByName(tools, adminOverlay.getTools().map(toToolSchema));
    }
  }

  // Merge the generic A2A overlay tool when active (flag on + vertical has a specialist).
  if (a2aActiveFor(activeId)) {
    const a2aOverlay = resolvePlugin('a2a');
    if (a2aOverlay && typeof a2aOverlay.getTools === 'function') {
      tools = mergeToolsByName(tools, a2aOverlay.getTools().map(toToolSchema));
    }
  }

  return tools;
}

async function executeToolFor(activeId, name, params, ctx, legacy) {
  const p = resolvePlugin(activeId);
  if (!p) return legacy(name, params, ctx);

  // First try the vertical's tools
  try {
    return await p.executeTool(name, params, ctx);
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
  let authz = p ? p.getAuthz() : legacy();

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

module.exports = {
  resolvePlugin, hasPlugin,
  heuristicsFor, systemPromptFor, toolSchemasFor, executeToolFor, authzFor,
  isPluginToolName,
  PLUGIN_OVERLAY_IDS,
};
