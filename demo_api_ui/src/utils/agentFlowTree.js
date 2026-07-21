// demo_api_ui/src/utils/agentFlowTree.js
/**
 * Groups a session's live flow steps (agentFlowDiagram.getState().steps) and
 * minted tokens (GET /api/token-chain/current) into the tree the Agent Flow
 * Inspector's Flow & Tokens tab renders. Pure — no side effects, no
 * fetching; steps/tokenChain are passed in already-loaded.
 *
 * Steps carry no timestamp (only a fixed pipeline order), so true
 * chronological interleaving of steps and tokens isn't possible — tokens
 * render in their own trailing group instead, sorted by their real
 * timestamp.
 */

const STEP_PHASE = {
  as: 'auth',
  agent: 'agent_gateway',
  bff: 'agent_gateway',
  'mcp-gateway': 'agent_gateway',
  pingauthorize: 'authorization',
  mcp: 'tool_execution',
  tool: 'tool_execution',
};

const PHASE_LABELS = {
  auth: 'AUTHENTICATION',
  agent_gateway: 'AGENT & GATEWAY',
  authorization: 'AUTHORIZATION',
  tool_execution: 'TOOL EXECUTION',
  other: 'OTHER',
};

const PHASE_ORDER = ['auth', 'agent_gateway', 'authorization', 'tool_execution', 'other'];

export function buildAgentFlowTree(steps, tokenChain) {
  const groups = new Map(
    PHASE_ORDER.map((key) => [key, { key, label: PHASE_LABELS[key], nodes: [] }])
  );

  (steps || []).forEach((step) => {
    const phaseKey = STEP_PHASE[step.id] || 'other';
    groups.get(phaseKey).nodes.push({
      id: `step-${step.id}`,
      kind: 'step',
      label: step.title,
      status: step.status,
      data: step,
    });
  });

  const sortedTokens = [...(tokenChain || [])].sort(
    (a, b) => (a.timestamp || 0) - (b.timestamp || 0)
  );
  if (sortedTokens.length) {
    groups.set('tokens', { key: 'tokens', label: 'TOKENS MINTED', nodes: [] });
    sortedTokens.forEach((token) => {
      groups.get('tokens').nodes.push({
        id: `token-${token.id}`,
        kind: 'token',
        label: token.tokenType ? token.tokenType.replace(/_/g, ' ') : 'Token',
        status: 'ok',
        data: token,
      });
    });
  }

  return [...PHASE_ORDER, 'tokens']
    .map((key) => groups.get(key))
    .filter((group) => group && group.nodes.length > 0);
}
