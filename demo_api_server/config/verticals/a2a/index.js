'use strict';

/**
 * A2A (agent-to-agent) overlay — a generic, vertical-agnostic capability (like the
 * `admin` role overlay). When ff_a2a_delegation is on AND the active vertical has a
 * specialist (see config/a2aSpecialists.js), this overlay merges a single tool
 * `delegate_to_specialist` + a delegation heuristic + a system-prompt hint into the
 * active vertical's agent.
 *
 * Execution is NOT performed here: the actual chained RFC 8693 delegation needs the
 * request (session token) + the shared tokenEvents array + the active vertical, so it
 * is intercepted upstream in demoAgentLangGraphService.resolveExecuteTool, which calls
 * a2aDelegationService.delegateToSpecialist(req, { vertical, ... }). This overlay's
 * executeTool is only a safety fallback.
 */

const DELEGATE_TOOL = {
  name: 'delegate_to_specialist',
  description:
    'Delegate a narrow, sensitive read sub-task to this vertical’s specialist agent (a SECOND agent). ' +
    'Use this when the user asks for sensitive or specialized data that you (the generalist) should not ' +
    'access directly. The specialist acts under a delegated identity — a nested RFC 8693 act chain ' +
    '(act:{specialist, act:{generalist}}) bound to the user — and the authorization server decides whether ' +
    'the delegation is permitted.',
  inputSchema: {
    type: 'object',
    properties: {
      subtask: { type: 'string', description: 'What the specialist should do on the user’s behalf.' },
      tool: { type: 'string', description: 'Optional: the specialist tool to call (defaults to the vertical specialist’s tool).' },
    },
  },
  scopes: [],
  authz: {}, // No BFF gate — PingOne Authorize decides over the act chain.
};

const MISMATCH_TOOL = {
  name: 'a2a_generalist_mismatch',
  description:
    'Simulate what happens when an UNREGISTERED agent tries to act as the generalist in a specialist ' +
    'delegation — sends a fabricated actor identity to the same PingOne Authorize decision the gateway ' +
    'uses and shows the resulting DENY. Teaching/demo only: does not mint a real second agent identity.',
  inputSchema: {
    type: 'object',
    properties: {
      subtask: { type: 'string', description: 'What the specialist would have been asked to do.' },
      tool: { type: 'string', description: 'Optional: the specialist tool to probe (defaults to the vertical specialist tool).' },
    },
  },
  scopes: [],
  authz: {},
};

// Delegation phrases route to delegate_to_specialist. The sensitive data itself is
// gated by Authorize (which denies the generalist), which is what prompts delegation.
const HEURISTICS = [
  {
    re: /\b(delegate|hand\s*(off|over)|escalate)\b.*\b(specialist|advisor|agent|expert)\b|\b(ask|consult|involve|bring\s+in)\b.{0,20}\b(specialist|advisor|expert)\b|\bsecond\s+agent\b|\bspecialist\s+agent\b/i,
    action: 'delegate_to_specialist',
  },
  {
    re: /\bagent\s+identity\s+mismatch\b|\bagent\s+mismatch\b|\bunregistered\s+agent\b/i,
    action: 'a2a_generalist_mismatch',
  },
];

function getSystemPrompt() {
  return [
    'You can delegate to a specialist agent.',
    'When the user requests sensitive or specialized data that you (the generalist) should not access directly,',
    'call delegate_to_specialist to hand the sub-task to this vertical’s specialist agent.',
    'The specialist acts under a delegated identity (a nested act chain bound to the user), and the',
    'authorization server approves or denies the delegation. Do not attempt to read the sensitive data yourself.',
  ].join(' ');
}

function getManifest() {
  return {
    id: 'a2a-overlay',
    identity: {
      displayName: 'Agent-to-Agent Delegation',
      headerTitle: 'A2A',
      documentTitle: 'Agent-to-Agent Delegation',
      tagline: 'Delegate sensitive sub-tasks to a specialist agent',
    },
    terminology: {},
  };
}

function getAuthz() {
  return { [DELEGATE_TOOL.name]: DELEGATE_TOOL.authz, [MISMATCH_TOOL.name]: MISMATCH_TOOL.authz };
}

module.exports = {
  getManifest,
  getTools: () => [DELEGATE_TOOL, MISMATCH_TOOL],
  getHeuristics: () => HEURISTICS,
  getSystemPrompt,
  getDataStore: () => ({ get: () => ({}) }),
  // Real execution is intercepted in demoAgentLangGraphService.resolveExecuteTool
  // (it needs req + active vertical + tokenEvents). This is only a fallback.
  executeTool: async (name) => {
    if (name === DELEGATE_TOOL.name) {
      return {
        result: { error: 'delegate_to_specialist must be handled by the A2A interception (missing req/vertical context).' },
        render: 'text',
      };
    }
    if (name === MISMATCH_TOOL.name) {
      return {
        result: { error: 'a2a_generalist_mismatch must be handled by the A2A interception (missing req/vertical context).' },
        render: 'text',
      };
    }
    return { result: { error: `unknown a2a action: ${name}` }, render: 'text' };
  },
  getAuthz,
};
