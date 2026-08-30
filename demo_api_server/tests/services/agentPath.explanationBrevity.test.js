/**
 * UC35 ("Explain why my last blocked action was denied and walk me through the
 * token chain") is an LLM-reasoning step with primaryTool: null. There is no
 * tool to pre-fetch, so the UC34 activity clause never fires and the model
 * narrates unbounded — "walk me through the token chain" invites a step-by-step
 * essay, and generation time scales with what it writes.
 *
 * REASON_LOOP_TIMEOUT_MS is a PER-REQUEST axios timeout (agentReasoningClient.js
 * passes it straight to the POST), so one long generation is enough to fail the
 * call — no loop required. UC34 was measured returning at 121.0s and 121.2s
 * against the 120000 ceiling; UC35 has the same shape with less grounding.
 *
 * This asserts the clause is appended, is NOT appended to ordinary prompts, and
 * that a prompt matching BOTH heuristics gets exactly one clause rather than two
 * contradictory sets of instructions.
 */

// Rows are per-test: an EMPTY result skips the activity clause, which is its own
// case below. Defaults to one row so the pre-fetch path behaves normally.
jest.mock('../../services/bffMcpToolExecutor', () => ({
  executeBffTool: jest.fn(async (a) => JSON.stringify({
    transactions: global.__activityRows ?? [
      { id: 'T1', date: '2026-07-01', type: 'debit', amount: -42.5, merchant: 'Whole Foods' },
    ],
    tool: a.name,
  })),
  executeBffToolWithToken: jest.fn(),
}));
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => false),
  delegateToSpecialist: jest.fn(),
}));
// Leaf stub: capture what the model would have been handed, run nothing.
jest.mock('../../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn(async ({ messages }) => {
    global.__capturedMessages = messages;
    return { ok: true, answer: 'ok', toolsCalled: [], inputTokens: 0, outputTokens: 0 };
  }),
}));

const UC35_PROMPT = 'Explain why my last blocked action was denied and walk me through the token chain';
// Matches BOTH heuristics: "explain ... blocked/denied" and "unusual ... activity".
const BOTH_PROMPT = 'explain why my blocked transfer was denied, given the unusual activity on my account';
const BREVITY = 'at most six short bullet points';
const ACTIVITY_CLAUSE = 'already retrieved for you via';

// setup.js resets the module registry after every test, so require inside.
function load() {
  const verticalManifest = require('../../services/verticalManifest').verticalManifest;
  verticalManifest.init();
  const configStore = require('../../services/configStore');
  // The clause lives on the LLM/reason-loop path; test defaults are heuristics,
  // which returns the capability catalog long before it.
  const realGet = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_heuristic_enabled') return 'false';
    if (k === 'agent_mode') return 'llamacpp';
    return realGet(k);
  });
  return { service: require('../../services/demoAgentLangGraphService') };
}

beforeEach(() => { global.__activityRows = undefined; });

function runAgent(service, message, vertical = 'banking') {
  global.__capturedMessages = null;
  return service.processAgentMessage({
    message,
    vertical,
    userId: 'u1',
    userToken: 'tok',
    sessionId: 's1',
    tokenEvents: [],
    langchainConfig: {},
    req: { session: { active_vertical: vertical }, tokenEvents: [] },
  });
}

const lastContent = () => {
  const msgs = global.__capturedMessages || [];
  return String(msgs[msgs.length - 1]?.content || '');
};

describe('UC35 explanation brevity clause — a timeout fix, not a style preference', () => {
  it("appends the clause to UC35's chip prompt", async () => {
    const { service } = load();
    await runAgent(service, UC35_PROMPT);
    expect(lastContent()).toContain(BREVITY);
  });

  it('leaves an ordinary prompt untouched', async () => {
    const { service } = load();
    await runAgent(service, 'show my accounts');
    expect(lastContent()).not.toContain(BREVITY);
  });

  // The guard that matters. BOTH_PROMPT satisfies both heuristics at once. The
  // activity path already grounds AND caps, so adding this clause on top would
  // hand the model two different bullet counts in a single turn.
  it('a prompt matching both heuristics gets the activity clause only', async () => {
    const { service } = load();
    await runAgent(service, BOTH_PROMPT);
    const content = lastContent();
    expect(content).toContain(ACTIVITY_CLAUSE);
    expect(content).not.toContain(BREVITY);
  });

  // Selecting a tool is not the same as grounding the answer. With no rows the
  // activity clause is skipped entirely, and before this the prompt went to the
  // model uncapped — the same unbounded narration UC35 fails on. Keying the
  // fallback off "was the clause applied" rather than "was a tool chosen"
  // closes it.
  it('still caps the answer when the activity pre-fetch comes back empty', async () => {
    global.__activityRows = [];
    const { service } = load();
    await runAgent(service, BOTH_PROMPT);
    const content = lastContent();
    expect(content).not.toContain(ACTIVITY_CLAUSE);
    expect(content).toContain(BREVITY);
  });
});
