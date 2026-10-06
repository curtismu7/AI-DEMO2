'use strict';
const { USE_CASES } = require('../config/useCases');

// "mcp-exchange" is not an id any producer emits, and computeVerdict only knows
// 'token-exchange' (any event carrying exchangeStep). Declaring it left a
// successful workload run reading "Incomplete - Waiting on mcp-exchange".
test.each(['personal-agent-concierge', 'workload-digital-assistant-obo', 'saas-embedded-worker'])(
  '%s declares the verdict-recognised exchange step',
  (useCaseId) => {
    const chain = USE_CASES.find((u) => u.useCaseId === useCaseId).evidence.tokenChain;
    expect(chain).toContain('token-exchange');
    expect(chain).not.toContain('mcp-exchange');
  },
);
