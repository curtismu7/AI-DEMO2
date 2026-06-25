'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { EDUCATION_HEURISTICS } = require('./educationHeuristics');

/**
 * Factory that builds a vertical's plugin object (the 7-method contract from
 * verticalManifest/pluginContract.js) from the parts a vertical actually owns:
 * its data store, tools, heuristics, and system prompt. Collapses the otherwise
 * identical index.js wiring and guarantees the easy-to-forget bits — appending
 * the shared EDUCATION_HEURISTICS and deriving getAuthz() from the tools.
 *
 * @param {object}   opts
 * @param {string}   opts.id            vertical id (must match the manifest dir)
 * @param {object}   opts.store         data store (returned verbatim by getDataStore)
 * @param {Array}    opts.tools         tool descriptors ({ name, authz, ... })
 * @param {Function} opts.execute       async (name, params, ctx) => { result, render }
 * @param {Array}    opts.heuristics    vertical heuristics ({ re, action }); EDUCATION_HEURISTICS are appended automatically
 * @param {string|Function} opts.systemPrompt  string, or (ctx) => string
 * @returns the plugin module object
 */
function createVerticalPlugin({ id, store, tools, execute, heuristics = [], systemPrompt }) {
  if (!id) throw new Error('createVerticalPlugin: id is required');
  if (!Array.isArray(tools)) throw new Error(`createVerticalPlugin(${id}): tools must be an array`);
  if (typeof execute !== 'function') throw new Error(`createVerticalPlugin(${id}): execute must be a function`);
  if (typeof systemPrompt !== 'string' && typeof systemPrompt !== 'function') {
    throw new Error(`createVerticalPlugin(${id}): systemPrompt must be a string or function`);
  }

  return {
    getManifest: () => verticalManifest.resolver.resolve(id),
    getTools: () => tools,
    getHeuristics: () => [...heuristics, ...EDUCATION_HEURISTICS],
    getSystemPrompt: (ctx) => (typeof systemPrompt === 'function' ? systemPrompt(ctx) : systemPrompt),
    getDataStore: () => store,
    executeTool: (name, params, ctx) => execute(name, params, ctx),
    getAuthz: () => Object.fromEntries(tools.map((t) => [t.name, t.authz || {}])),
  };
}

module.exports = { createVerticalPlugin };
