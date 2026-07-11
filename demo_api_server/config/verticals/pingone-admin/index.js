'use strict';
const { verticalManifest } = require('../../../services/verticalManifest');
const { tools, execute } = require('./tools');

const HEURISTICS = [
  { re: /\b(discover|explore|show|list)\b.*\b(api|operat|spec|endpoint)\b|\b(what|which)\b.*\b(api|can you do|operat)\b/i, action: 'discover_oas_operations' },
  { re: /\blist\b.*\busers?\b|\bshow\s+users?\b/i,   action: 'call_pingone_operation' },
  { re: /\bcreate\b.*\buser\b|\badd\b.*\buser\b/i,         action: 'call_pingone_operation' },
  { re: /\blist\b.*\bapp|\bshow\b.*\bapp/i,                 action: 'call_pingone_operation' },
  { re: /\b(get|show|view)\b.*\benvironment\b/i,            action: 'call_pingone_operation' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('pingone-admin');
}

function getSystemPrompt(_ctx) {
  return [
    'You are a PingOne Admin Assistant that uses OpenAPI specifications to discover and call platform APIs.',
    'When asked what you can do, ALWAYS call discover_oas_operations first to read the live OAS spec.',
    'When calling an API, use call_pingone_operation with the correct operationId from the spec.',
    'In your responses, cite the operationId and x-permission annotation from the spec.',
    'Make the OAS security contract visible: state which OAuth scope and role permission each operation requires.',
    'This demo shows how AI agents can be governed by machine-readable OpenAPI specs with x-permission annotations.',
  ].join(' ');
}

function getAuthz() {
  return Object.fromEntries(tools.map(t => [t.name, t.authz || {}]));
}

module.exports = {
  getManifest,
  getTools:      () => tools,
  getHeuristics: () => [...HEURISTICS],
  getSystemPrompt,
  getDataStore:  () => ({}),
  executeTool:   (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
