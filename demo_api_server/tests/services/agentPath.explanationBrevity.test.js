/**
 * UC35 — "Explain why my last blocked action was denied and walk me through the
 * token chain" — has primaryTool: null, so UC34's activity pre-fetch never fires
 * and nothing grounds the answer.
 *
 * MEASURED 2026-08-30 against the live model, three runs on main:
 *
 *   run 1  120.5s  304 chars  OVER CEILING, give-up prose (reasoning_unavailable)
 *   run 2   96.9s   38 chars  "I'm sorry, but I can't help with that."
 *   run 3    7.3s   38 chars  identical
 *
 * Two conclusions, both of which killed the first theory:
 *
 *  1. The model REFUSES — 38 characters, not a long narration. Priming the
 *     session with a genuine DENY first changed nothing (17.4s, same 38 chars),
 *     so the decision never reached the model and refusing was CORRECT.
 *  2. Capping length fixes nothing when there is no long answer. 7.3s and 96.9s
 *     produced byte-identical output, so the spread is backend latency, not
 *     generation — the 120s ceiling is a symptom, not the cause.
 *
 * So the fix is GROUNDING. These assert the evidence is injected, that the empty
 * case still answers instead of refusing, and that a prompt matching both
 * heuristics gets one clause rather than two contradictory ones.
 */

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
const NO_DECISION = 'No blocked or denied decision is recorded';
// The shape the live stack actually records. Measured 2026-08-30 via
// /api/admin/app-events: `authorize` had ZERO events and `intent_auth` did not
// exist as a category, while the real denial sat under `enterprise_mcp`.
const DENIAL_MSG = 'enterprise_mcp.policy_check — DENY';

beforeEach(() => { global.__activityRows = undefined; global.__denialEvents = undefined; });

// setup.js resets the module registry after every test, so require inside.
function load() {
  const verticalManifest = require('../../services/verticalManifest').verticalManifest;
  verticalManifest.init();
  const configStore = require('../../services/configStore');
  const realGet = configStore.getEffective.bind(configStore);
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) => {
    if (k === 'ff_heuristic_enabled') return 'false';
    if (k === 'agent_mode') return 'llamacpp';
    return realGet(k);
  });
  // Real events would leak between tests; drive the pre-fetch explicitly.
  const appEventService = require('../../services/appEventService');
  jest.spyOn(appEventService, 'getEvents').mockImplementation(() => global.__denialEvents ?? []);
  return { service: require('../../services/demoAgentLangGraphService') };
}

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

describe('UC35 explanation grounding — the model was never given the decision', () => {
  it('injects the recorded denial so the model has something to explain', async () => {
    global.__denialEvents = [
      { timestamp: '2026-08-30T11:41:00Z', category: 'enterprise_mcp', severity: 'warning', message: DENIAL_MSG },
    ];
    const { service } = load();
    await runAgent(service, UC35_PROMPT);
    const content = lastContent();
    expect(content).toContain(DENIAL_MSG);
    expect(content).toContain(BREVITY);
  });

  // The measured failure. With nothing recorded the model refused outright,
  // which is a dead end for the demo; naming what would produce a block still
  // teaches the control.
  it('answers instead of refusing when no decision is recorded', async () => {
    global.__denialEvents = [];
    const { service } = load();
    await runAgent(service, UC35_PROMPT);
    const content = lastContent();
    expect(content).toContain(NO_DECISION);
    expect(content).not.toContain(BREVITY);
  });

  // The agent's own earlier reply is logged at agent_prompt and can quote the
  // word "denied". Treating that as evidence would have the agent explain its
  // own previous answer — a feedback loop, not grounding. Live data contained
  // exactly this: three agent_prompt rows echoing the empty-branch sentence.
  it('never treats its own prose as evidence of a denial', async () => {
    global.__denialEvents = [
      { timestamp: '2026-08-30T11:50:00Z', category: 'agent_prompt', severity: 'warning', message: 'LLM response: no blocked or denied decision is recorded' },
    ];
    const { service } = load();
    await runAgent(service, UC35_PROMPT);
    expect(lastContent()).toContain(NO_DECISION);
  });

  // Only non-PERMIT decisions are evidence. An info-severity PERMIT is not a
  // block, and a warning with no decision words is not one either.
  it('ignores PERMIT/info events and non-decision warnings', async () => {
    global.__denialEvents = [
      { timestamp: '2026-08-30T11:00:00Z', category: 'authorize', severity: 'info', message: 'PERMIT transfer' },
      { timestamp: '2026-08-30T11:00:01Z', category: 'agent', severity: 'warning', message: 'unrelated warning' },
    ];
    const { service } = load();
    await runAgent(service, UC35_PROMPT);
    const content = lastContent();
    expect(content).toContain(NO_DECISION);
    expect(content).not.toContain('PERMIT transfer');
    expect(content).not.toContain('unrelated warning');
  });

  it('leaves an ordinary prompt untouched', async () => {
    const { service } = load();
    await runAgent(service, 'show my accounts');
    const content = lastContent();
    expect(content).not.toContain(BREVITY);
    expect(content).not.toContain(NO_DECISION);
  });

  // BOTH_PROMPT satisfies both heuristics. The activity path already grounds and
  // caps, so adding this on top would hand the model two different bullet counts
  // in a single turn.
  it('a prompt matching both heuristics gets the activity clause only', async () => {
    const { service } = load();
    await runAgent(service, BOTH_PROMPT);
    const content = lastContent();
    expect(content).toContain(ACTIVITY_CLAUSE);
    expect(content).not.toContain(BREVITY);
    expect(content).not.toContain(NO_DECISION);
  });

  // Selecting a tool is not grounding an answer: an empty pre-fetch skips the
  // activity clause, and before this the prompt reached the model with no
  // handling at all.
  it('falls through to the explanation path when the activity pre-fetch is empty', async () => {
    global.__activityRows = [];
    global.__denialEvents = [];
    const { service } = load();
    await runAgent(service, BOTH_PROMPT);
    const content = lastContent();
    expect(content).not.toContain(ACTIVITY_CLAUSE);
    expect(content).toContain(NO_DECISION);
  });
});
