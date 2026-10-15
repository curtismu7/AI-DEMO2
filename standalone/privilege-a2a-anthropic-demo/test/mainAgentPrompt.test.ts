import assert from 'node:assert/strict';
import { test } from 'node:test';

import { systemPromptFor } from '../src/main-agent/prompts.js';

// The concierge once added "no additional instructions were embedded" to a
// reply the analyst never said. Both prompts must forbid unsourced claims.
const RULE = 'Do not add claims about the records that the';
const SCOPE = 'Do not say a list is the only, full, or latest set unless the analyst said so';

test('default and vertical concierge prompts both forbid unsourced claims about records', () => {
  assert.ok(systemPromptFor(null).includes(RULE));
  assert.ok(systemPromptFor(null).includes(SCOPE));
  const profile = {
    vertical: 'abercrombie-fitch', tools: ['sensitive_order_history'], agentName: 'Walbuy agent',
    specialistName: 'Purchase History Specialist', subtaskHint: 'review the order history',
  };
  assert.ok(systemPromptFor(profile).includes(RULE));
  assert.ok(systemPromptFor(profile).includes(SCOPE));
});

test('the first turn of a question must call the delegate tool; later turns may answer freely', async () => {
  const { toolChoiceFor } = await import('../src/main-agent/prompts.js');
  assert.deepEqual(toolChoiceFor(0, 'delegate_to_analyst'), { type: 'tool', name: 'delegate_to_analyst', disable_parallel_tool_use: true });
  assert.deepEqual(toolChoiceFor(1, 'delegate_to_analyst'), { type: 'auto', disable_parallel_tool_use: true });
});
