// banking_agent_service/tests/helixMultiTurn.integration.test.ts
// Reproduces C-1: across a tool round-trip, the tool RESULT must reach Helix.
// This does NOT mock helixReason or the 2nd-turn return — it drives a fake
// callHelix and asserts the SECOND call's prompt contains the tool result.
import { helixReason } from '../src/helixToolAdapter';
import type { ReasonToolSchema, ReasonMessage } from '../src/reasonContract';

const TOOLS: ReasonToolSchema[] = [
  { name: 'get_my_transactions', description: 'list txns', inputSchema: { type: 'object', properties: {} } },
];

test('C-1: tool result is delivered to Helix on the follow-up turn (no infinite re-call)', async () => {
  const seenPrompts: string[] = [];
  // Turn 1: user asks → Helix emits a TOOL_CALL.
  // Turn 2: BFF has executed the tool and appended a {role:'tool'} result;
  //         Helix MUST see that result and produce a final answer.
  let turn = 0;
  const fakeClient = async (_cfg: any, msgs: ReasonMessage[]) => {
    // Capture the actual prompt text Helix would receive (last user msg).
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
    seenPrompts.push(lastUser ? lastUser.content : '');
    turn += 1;
    if (turn === 1) return 'TOOL_CALL: {"name":"get_my_transactions","args":{}}';
    return 'You have 3 recent transactions totaling $42.'; // final answer turn 2
  };

  // Turn 1
  const r1 = await helixReason({}, [{ role: 'user', content: 'show my transactions' }], TOOLS, fakeClient);
  expect(r1.tool_calls?.[0].name).toBe('get_my_transactions');

  // BFF executes the tool and appends the result (mimics agentReasoningClient).
  const turn2Messages: ReasonMessage[] = [
    { role: 'user', content: 'show my transactions' },
    { role: 'assistant', content: '', tool_calls: r1.tool_calls },
    { role: 'tool', content: '[{"amount":42,"desc":"coffee"}]', tool_call_id: r1.tool_calls![0].id },
  ];
  const r2 = await helixReason({}, turn2Messages, TOOLS, fakeClient);

  // The 2nd Helix prompt MUST contain the tool result (the bug: it did not).
  expect(seenPrompts.length).toBe(2);
  expect(seenPrompts[1]).toContain('TOOL RESULT');
  expect(seenPrompts[1]).toContain('coffee'); // the actual tool output reached Helix
  expect(seenPrompts[1]).toContain('show my transactions'); // original question retained
  // And Helix produced a final answer, not another tool call.
  expect(r2.content).toContain('3 recent transactions');
  expect(r2.tool_calls).toBeUndefined();
});
