import assert from 'node:assert/strict';
import { test } from 'node:test';

import { systemPromptFor } from '../src/main-agent/prompts.js';

// The concierge once added "no additional instructions were embedded" to a
// reply the analyst never said. Both prompts must forbid unsourced claims.
const RULE = 'Do not add claims about the records that the';

test('default and vertical concierge prompts both forbid unsourced claims about records', () => {
  assert.ok(systemPromptFor(null).includes(RULE));
  const profile = {
    vertical: 'abercrombie-fitch', tools: ['sensitive_order_history'], agentName: 'A&F agent',
    specialistName: 'Purchase History Specialist', subtaskHint: 'review the order history',
  };
  assert.ok(systemPromptFor(profile).includes(RULE));
});
