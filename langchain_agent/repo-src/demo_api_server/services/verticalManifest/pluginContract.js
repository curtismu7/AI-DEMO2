'use strict';

const REQUIRED_METHODS = [
  'getManifest', 'getTools', 'getHeuristics', 'getSystemPrompt',
  'getDataStore', 'executeTool', 'getAuthz',
];

/**
 * Validate a loaded plugin object against the contract.
 * Pure — no I/O. Returns { ok, errors }.
 */
function validatePlugin(id, plugin) {
  const errors = [];
  if (!plugin || typeof plugin !== 'object') {
    return { ok: false, errors: [`plugin for "${id}" is not an object`] };
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof plugin[m] !== 'function') {
      errors.push(`plugin "${id}" is missing required method ${m}()`);
    }
  }
  if (typeof plugin.getSystemPrompt === 'function') {
    let prompt;
    try { prompt = plugin.getSystemPrompt({}); } catch (e) { errors.push(`plugin "${id}" getSystemPrompt() threw: ${e.message}`); }
    if (typeof prompt !== 'undefined' && (typeof prompt !== 'string' || prompt.trim() === '')) {
      errors.push(`plugin "${id}" getSystemPrompt() must return a non-empty string`);
    }
  }
  // Cross-check: every heuristic action must be a declared tool name.
  if (typeof plugin.getTools === 'function' && typeof plugin.getHeuristics === 'function') {
    let toolNames = [];
    let heuristics = [];
    try { toolNames = plugin.getTools().map((t) => t && t.name); } catch (e) { errors.push(`plugin "${id}" getTools() threw: ${e.message}`); }
    try {
      heuristics = plugin.getHeuristics();
      if (!Array.isArray(heuristics)) {
        errors.push(`plugin "${id}" getHeuristics() must return an array, got ${typeof heuristics}`);
        heuristics = [];
      }
    } catch (e) { errors.push(`plugin "${id}" getHeuristics() threw: ${e.message}`); }
    for (const h of heuristics) {
      if (h && h.action && !toolNames.includes(h.action)) {
        errors.push(`plugin "${id}" heuristic action "${h.action}" is not a declared tool name`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { REQUIRED_METHODS, validatePlugin };
