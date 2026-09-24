import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActivityNarrativeProvider } from '../../context/ActivityNarrativeContext';
import { ProofOfEnforcementProvider } from '../../context/ProofOfEnforcementContext';
import { useAuth } from '../../hooks/useAuth';
import { tokenChainTraceStore } from '../../services/tokenChainTrace/tokenChainTraceStore';
import { clearIdJagRunState, ID_JAG_USE_CASE_ID, ID_JAG_VALIDATED_CALLBACK_KEY } from '../../utils/idJagRunMode';

let providerMode = 'heuristics';
const completePost = vi.fn().mockResolvedValue({ data: {} });

vi.mock('../../context/IndustryBrandingContext', () => ({
  useIndustryBranding: () => ({ preset: { shortName: 'Super Banking', name: 'Super Banking' } }),
}));
vi.mock('../../context/EducationUIContext', () => ({
  useEducationUIOptional: () => ({ open: vi.fn(), close: vi.fn() }),
  useEducationUI: () => ({ open: vi.fn(), close: vi.fn() }),
}));
vi.mock('../../context/TokenChainContext', () => ({ useTokenChainOptional: () => null }));
vi.mock('../../context/AgentUiModeContext', () => ({
  useAgentUiMode: () => ({ placement: 'none', fab: true, setAgentUi: vi.fn() }),
}));
vi.mock('../../context/SessionTokenContext', () => ({
  useSessionToken: () => ({ tokenSecondsLeft: 900, tokenLoading: false, staleSession: false, hasActiveToken: true }),
}));
vi.mock('../../hooks/useAgentState', () => ({
  useAgentState: () => ({
    state: { messages: [], toolCalls: [], tokenEvents: [], mcpTraffic: [], authorizeDecisions: [], lastTokenUsage: null, lastOutcome: null, hitlPending: null, error: null },
    handlers: {}, reset: vi.fn(),
  }),
}));
vi.mock('../../hooks/useAgentRun', () => ({ useAgentRun: () => ({ run: vi.fn(), abort: vi.fn() }) }));
vi.mock('../../hooks/useLangchainProvider', () => ({
  default: () => ({ mode: providerMode, provider: 'google', keySet: { google: true }, modeOptions: [], setMode: vi.fn(), setProvider: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../AgentModeSelector', () => ({ default: () => null }));
vi.mock('../../services/demoAgentNlService', () => ({ fetchNlStatus: vi.fn().mockResolvedValue({}), parseNaturalLanguage: vi.fn() }));
vi.mock('../../services/demoAgentService', async () => ({
  ...(await vi.importActual('../../services/demoAgentService')),
  getMyAccounts: vi.fn().mockResolvedValue({ result: { accounts: [] } }),
  getMyTransactions: vi.fn().mockResolvedValue({ result: { transactions: [] } }),
  fetchAgentTools: vi.fn().mockResolvedValue({ availableTools: [], vertical: null, allowWrite: true }),
  warmupAuthz: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/configService', () => ({
  loadPublicConfig: vi.fn().mockResolvedValue({}), savePublicConfig: vi.fn().mockResolvedValue(),
}));
vi.mock('../../services/cachedStatusService', () => ({
  getCachedJson: vi.fn().mockResolvedValue({ data: { authenticated: false } }),
  getCachedStatus: vi.fn().mockResolvedValue({ flags: [] }), clearStatusCache: vi.fn(),
}));
vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn().mockResolvedValue({ data: {} }), patch: vi.fn().mockResolvedValue({ data: {} }) },
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal();
  return { default: { ...actual.default, get: vi.fn().mockResolvedValue({ data: { config: {} } }) } };
});
vi.mock('../../services/bffAxios', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: {} }), post: (...args) => completePost(...args) },
}));
vi.mock('../../utils/agentToolSteps', () => ({ getToolStepsForAction: vi.fn(() => []) }));
vi.mock('../../services/agentAccessConsent', () => ({
  isAgentBlockedByConsentDecline: vi.fn(() => false), setAgentBlockedByConsentDecline: vi.fn(),
  AGENT_CONSENT_BLOCK_USER_MESSAGE: 'Blocked by consent decline.', getConsentState: vi.fn(() => null), setConsentDeclined: vi.fn(),
}));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('../../utils/appToast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warn: vi.fn(), warning: vi.fn(), update: vi.fn(), dismiss: vi.fn() },
  notifySuccess: vi.fn(), notifyError: vi.fn(), notifyInfo: vi.fn(), notifyWarning: vi.fn(),
}));
vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({
    activeId: 'banking', pageManifest: { id: 'banking', identity: { displayName: 'Super Banking' } },
    agentManifest: { id: 'banking', identity: { displayName: 'Super Banking' } },
    adminManifest: null, pageMockData: null, isAdminScope: false, isAdmin: false, refetch: vi.fn(),
  }),
}));

import AIAgent from '../AIAgent';
import AIAgentFull from '../AIAgentFull';

function AuthSubscriber() { useAuth(); return null; }
const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
let finishTool;
let nlResult;

beforeEach(() => {
  providerMode = 'heuristics';
  finishTool = null;
  completePost.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  clearIdJagRunState();
  tokenChainTraceStore.reset();
  nlResult = { source: 'heuristic', result: { kind: 'banking', banking: { action: 'balance', params: {} } } };
  global.fetch = vi.fn((url) => {
    if (url === '/api/accounts/my') return Promise.resolve(jsonResponse({ accounts: [{ id: 'account-123', accountType: 'checking' }] }));
    if (url === '/api/demo-agent/nl') return Promise.resolve(jsonResponse(nlResult));
    if (url === '/api/mcp/tool') return new Promise((resolve) => { finishTool = () => resolve(jsonResponse({ result: { balance: 100 }, tokenEvents: [] })); });
    return Promise.resolve(jsonResponse({}));
  });
});

function renderAgent(Agent, native = true) {
  if (native) sessionStorage.setItem(ID_JAG_VALIDATED_CALLBACK_KEY, JSON.stringify({
    idJagCallbackValidated: true, useCaseId: ID_JAG_USE_CASE_ID, mode: 'live-id-jag', message: 'show my balance',
  }));
  render(<MemoryRouter initialEntries={['/dashboard']}><ActivityNarrativeProvider><ProofOfEnforcementProvider>
    <AuthSubscriber />
    <Agent user={{ id: 'u1', role: 'customer' }} mode="inline" />
  </ProofOfEnforcementProvider></ActivityNarrativeProvider></MemoryRouter>);
}

async function typeReply(text) {
  const input = screen.getByPlaceholderText(/^Message |^Ask about/);
  fireEvent.change(input, { target: { value: text } });
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
}

for (const [name, Agent] of [['compact', AIAgent], ['full', AIAgentFull]]) {
  test(`${name} typed clarification keeps the PF grant until the UC40 tool completes`, async () => {
    renderAgent(Agent);
    await screen.findByText(/Which account would you like to check the balance for/i);
    expect(tokenChainTraceStore.getState().trace).toMatchObject({ mode: 'live-id-jag', provenance: 'live-id-jag', outcome: null });
    expect(completePost).not.toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete');

    await typeReply('checking');
    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/mcp/tool')).toBe(true));
    const request = global.fetch.mock.calls.find(([url]) => url === '/api/mcp/tool');
    expect(JSON.parse(request[1].body)).toMatchObject({
      tool: 'get_account_balance', params: { account_id: 'account-123' }, useCaseId: ID_JAG_USE_CASE_ID,
    });
    expect(tokenChainTraceStore.getState().trace).toMatchObject({ mode: 'live-id-jag', provenance: 'live-id-jag', outcome: null });
    expect(completePost).not.toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete');
    await act(async () => finishTool());
    await waitFor(() => expect(completePost).toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete'));
    await waitFor(() => expect(sessionStorage.getItem(ID_JAG_VALIDATED_CALLBACK_KEY)).toBeNull());
    expect(completePost.mock.calls.filter(([url]) => url === '/api/auth/oauth/user/id-jag/complete')).toHaveLength(1);
  });

  test(`${name} explicit heuristic fallback retains the PF grant until its tool completes`, async () => {
    providerMode = 'gemini';
    nlResult = { source: 'heuristic', llm_attempted: false, result: { kind: 'banking', banking: { action: 'balance', params: { accountId: 'account-123' } } } };
    renderAgent(Agent);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/demo-agent/nl', expect.anything()));
    const button = await screen.findByRole('button', { name: 'Use Heuristics' });
    expect(tokenChainTraceStore.getState().trace).toMatchObject({ mode: 'live-id-jag', provenance: 'live-id-jag', outcome: null });
    expect(completePost).not.toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete');
    await act(async () => fireEvent.click(button));
    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/mcp/tool')).toBe(true));
    const request = global.fetch.mock.calls.find(([url]) => url === '/api/mcp/tool');
    expect(JSON.parse(request[1].body)).toMatchObject({ tool: 'get_account_balance', useCaseId: ID_JAG_USE_CASE_ID });
    expect(completePost).not.toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete');
    await act(async () => finishTool());
    await waitFor(() => expect(completePost).toHaveBeenCalledWith('/api/auth/oauth/user/id-jag/complete'));
    await waitFor(() => expect(sessionStorage.getItem(ID_JAG_VALIDATED_CALLBACK_KEY)).toBeNull());
  });

  test(`${name} ordinary typed NL does not attach UC40 or native provenance`, async () => {
    nlResult = { source: 'heuristic', result: { kind: 'banking', banking: { action: 'balance', params: { accountId: 'account-123' } } } };
    renderAgent(Agent, false);
    await typeReply('show my balance');
    await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/mcp/tool')).toBe(true));
    const request = global.fetch.mock.calls.find(([url]) => url === '/api/mcp/tool');
    expect(JSON.parse(request[1].body)).not.toHaveProperty('useCaseId');
    expect(tokenChainTraceStore.getState().trace.mode).toBeNull();
    await act(async () => finishTool());
  });
}
