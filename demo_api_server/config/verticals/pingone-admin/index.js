'use strict';
const { verticalManifest } = require('../../../services/verticalManifest');
const { tools, execute } = require('./tools');

// Each call_pingone_tool heuristic pins the hosted MCP tool name it resolves to,
// so a chip's phrasing ("List Users", "Create User", …) maps deterministically to
// the right tool. The parser injects h.defaultParams into the parsed params,
// satisfying the tool's required `name` without asking the user to name the tool.
// Order matters: specific data heuristics come before the broad discovery regex.
const HEURISTICS = [
  { re: /\blist\b.*\busers?\b|\bshow\s+users?\b|\bhow many\b.*\b(users?|identit)/i, action: 'call_pingone_tool', defaultParams: { name: 'listUsers' } },
  { re: /\b(look\s*up|find|get|search)\b.*\buser\b|\buser\b.*\b(look\s*up|detail|info|profile)/i, action: 'call_pingone_tool', defaultParams: { name: 'getUser' } },
  { re: /\bcreate\b.*\buser\b|\badd\b.*\buser\b|\bnew\b.*\buser\b/i,                action: 'call_pingone_tool', defaultParams: { name: 'createUser' } },
  { re: /\blist\b.*\bapp|\bshow\b.*\bapp/i,                                          action: 'call_pingone_tool', defaultParams: { name: 'listApplications' } },
  { re: /\blist\b.*\bgroup|\bshow\b.*\bgroup/i,                                      action: 'call_pingone_tool', defaultParams: { name: 'listGroups' } },
  { re: /\blist\b.*\bpopulation|\bshow\b.*\bpopulation/i,                            action: 'call_pingone_tool', defaultParams: { name: 'listPopulations' } },
  { re: /\b(get|show|view)\b.*\benvironment\b/i,                                     action: 'call_pingone_tool', defaultParams: { name: 'getEnvironment' } },
  { re: /\b(discover|explore|show|list|what|which)\b.*\b(tools?|apis?|operat|capabilit|can you do)/i, action: 'list_pingone_tools' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('pingone-admin');
}

function getSystemPrompt(_ctx) {
  return [
    'You are a PingOne Admin Assistant connected to the hosted PingOne MCP server.',
    'When asked what you can do, ALWAYS call list_pingone_tools first — the visible tool set is gated by the worker application\'s admin roles in PingOne.',
    'Call tools with call_pingone_tool using the exact tool name and camelCase arguments from the live tool list.',
    'Every result carries a source field: state whether the answer came from the live server or from labeled mock fallback data.',
    'This demo shows an AI agent whose capabilities are governed by the identity it runs as, not by hardcoded features.',
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
