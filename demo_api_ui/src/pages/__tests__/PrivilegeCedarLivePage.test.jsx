import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/privilegeAiPoliciesDemoService', () => ({ connectDoor: vi.fn(), runTool: vi.fn() }));
vi.mock('../../services/privilegePfTokenDemoService', () => ({ getState: vi.fn(), runDemo: vi.fn() }));
import { connectDoor, runTool } from '../../services/privilegeAiPoliciesDemoService';
import { getState, runDemo } from '../../services/privilegePfTokenDemoService';
import PrivilegeCedarLivePage from '../PrivilegeCedarLivePage';
import { CEDAR_IS, CEDAR_ISNT, SETUP_STEPS } from '../../config/privilegeAiPoliciesDemo';
import { ACT_SUB_NOT_MEASURED } from '../../config/privilegePfTokenDemo';

// @xyflow/react (imported through the PingFederate token page) observes its container's size; jsdom has no ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const page = (props) => render(<MemoryRouter><PrivilegeCedarLivePage {...props} /></MemoryRouter>);

const STATE = { configured: true, issuer: 'https://pf.example.test', clientId: 'agent-client', doorUrl: 'https://gw.example.test/pftoken/mcp' };
const HOLD = { outcome: 'hold', instructionId: 'ins_0123456789abcdef', detail: 'pending_approval', raw: { result: { content: [{ text: 'pending_approval ins_0123456789abcdef' }] } } };
const ALLOW = { outcome: 'allow', detail: 'index-a', raw: { result: { content: [{ text: 'index-a' }] } } };

const CLAIM = { act: { sub: 'agent-client' }, actKind: 'object', sub: 'agent-client' };
const COUNT_OK = { tool: 'CountTool', status: 200, verdict: 'allowed', message: '' };
const LIST_OK = { tool: 'ListIndexTool', status: 200, verdict: 'allowed', message: '' };
const LIST_BLOCKED = { tool: 'ListIndexTool', status: 400, verdict: 'blocked-by-cedar', message: 'action denied by policy: ListIndexTool requires act.sub to be some-other-agent' };
const SCOPE_BLOCKED = { key: 'without', scope: 'opensearch:admin', status: 400, verdict: 'blocked-by-cedar', message: "action denied by policy: SearchIndexTool needs the opensearch:search scope in the agent's token" };
const SCOPE_OK = { key: 'with', scope: 'opensearch:admin opensearch:search', status: 200, verdict: 'allowed', message: 'search ran' };
const RUN = {
  at: '2026-11-16T10:00:00.000Z',
  mint: { status: 200, claims: { sub: 'agent-client', act: { sub: 'agent-client' } } },
  pfToken: { status: 200, verdict: 'allowed', tools: ['ListIndexTool'], detail: '' },
  garbage: { status: 401, verdict: 'token-rejected', tools: [], detail: 'Bearer token required' },
  cedar: [SCOPE_BLOCKED, SCOPE_OK],
  actSub: { claim: CLAIM, tools: [COUNT_OK, LIST_BLOCKED], enforcing: true },
};
const withRun = (patch) => ({ status: 200, data: { ...RUN, ...patch } });

const mockSignedIn = () => {
  connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
  getState.mockResolvedValue({ status: 200, data: STATE });
};
const readyPage = async () => {
  page();
  await waitFor(() => expect(screen.getByTestId('pcl-run-hold')).toBeEnabled());
  await waitFor(() => expect(screen.getByTestId('pcl-run-scope')).toBeEnabled());
};
const primaries = () => [...document.querySelectorAll('.pu-btn--primary')];

beforeEach(() => { vi.resetAllMocks(); });

describe('PrivilegeCedarLivePage (live): the start-here content', () => {
  it('says the verdicts come from the gateway, the page runs no Cedar engine, and the Cedar is a dated copy', async () => {
    mockSignedIn();
    page();
    const banner = screen.getByTestId('pcl-banner');
    expect(banner).toHaveTextContent(/comes from the Privilege gateway/);
    expect(banner).toHaveTextContent(/runs no Cedar engine/);
    expect(banner).toHaveTextContent(/copy read from the console on 2026-11-16/);
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'ready'));
  });

  it('opens with the existing Set up Cedar in Privilege content, taken from the AI Policies config', async () => {
    mockSignedIn();
    page();
    expect(screen.getByRole('heading', { name: 'Set up Cedar in Privilege' })).toBeInTheDocument();
    expect(within(screen.getByTestId('pcl-setup-steps')).getAllByRole('listitem')).toHaveLength(SETUP_STEPS.length);
    expect(within(screen.getByTestId('pcl-is')).getAllByRole('listitem')).toHaveLength(CEDAR_IS.length);
    expect(within(screen.getByTestId('pcl-isnt')).getAllByRole('listitem')).toHaveLength(CEDAR_ISNT.length);
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'ready'));
  });

  it('presents three steps in order, each with its Cedar and the state of that Cedar', async () => {
    mockSignedIn();
    page();
    const steps = ['pcl-step-hold', 'pcl-step-scope', 'pcl-step-actsub'].map((id) => screen.getByTestId(id));
    expect(steps[0].compareDocumentPosition(steps[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(steps[1].compareDocumentPosition(steps[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(steps[0]).toHaveTextContent('Step 1 of 3');
    expect(steps[2]).toHaveTextContent('Step 3 of 3');
    const hold = screen.getByTestId('pcl-policy-hitl-opensearch');
    expect(hold).toHaveTextContent('Active');
    expect(hold).toHaveTextContent('console copy read 2026-11-16');
    expect(hold).toHaveTextContent('Action::"mcp:InvokeUnattended"');
    expect(screen.getByTestId('pcl-policy-pftoken-scope-search')).toHaveTextContent('context.token.scopes.contains');
    const allow = screen.getByTestId('pcl-policy-pftoken-actsub-allow');
    expect(allow).toHaveTextContent('Active');
    expect(allow).toHaveTextContent('console copy read 2026-11-16');
    expect(allow).toHaveTextContent('context.token.claims["act.sub"].contains("<client id>")');
    expect(screen.getByTestId('pcl-policy-pftoken-actsub-deny')).toHaveTextContent('some-other-agent');
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'ready'));
  });

  it('closes with what is measured and what is not, including the five act.sub gaps', async () => {
    mockSignedIn();
    page();
    expect(screen.getByRole('heading', { name: 'What is measured, and what is not' })).toBeInTheDocument();
    expect(screen.getByTestId('pcl-measured')).toHaveTextContent('about 7 seconds');
    expect(screen.getByTestId('pcl-measured')).toHaveTextContent('-32600');
    const gaps = screen.getByTestId('pcl-notmeasured');
    for (const g of ACT_SUB_NOT_MEASURED) expect(gaps).toHaveTextContent(g);
    expect(screen.getByTestId('pcl-actsub-isnt')).toHaveTextContent('Not a second agent');
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'ready'));
  });
});

describe('PrivilegeCedarLivePage (live): sign-in first states', () => {
  it('step 1 not signed in to the door: says so, links to the Privilege client and keeps Run off', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: false });
    getState.mockResolvedValue({ status: 200, data: STATE });
    page();
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'signin'));
    expect(screen.getByTestId('pcl-conn')).toHaveTextContent('Sign in needed');
    expect(screen.getByRole('link', { name: 'Open the Privilege client' })).toHaveAttribute('href', '/privilege-mcp-client');
    expect(screen.getByTestId('pcl-run-hold')).toBeDisabled();
    expect(runTool).not.toHaveBeenCalled();
  });

  it('a 401 while connecting is the sign-in state, not an error', async () => {
    connectDoor.mockRejectedValue(Object.assign(new Error('unauthorized'), { status: 401 }));
    getState.mockResolvedValue({ status: 200, data: STATE });
    page();
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'signin'));
  });

  it('a door that is not registered, and an unreachable client, are shown in words', async () => {
    connectDoor.mockResolvedValueOnce({ ok: false, reason: 'no-door' });
    getState.mockResolvedValue({ status: 200, data: STATE });
    page();
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'nodoor'));
    expect(screen.getByTestId('pcl-conn')).toHaveTextContent('not registered on this gateway');
  });

  it('a failure to reach the client is an error state with the reason', async () => {
    connectDoor.mockRejectedValue(new Error('network down'));
    getState.mockResolvedValue({ status: 200, data: STATE });
    page();
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'error'));
    expect(screen.getByTestId('pcl-conn')).toHaveTextContent('network down');
  });

  it('steps 2 and 3 signed out of the demo app: a sign-in strip and both runs off', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    getState.mockResolvedValue({ status: 401, data: {} });
    page();
    expect(await screen.findByText(/Sign in to the demo app to mint a PingFederate token/)).toBeInTheDocument();
    expect(screen.getByTestId('pcl-run-scope')).toBeDisabled();
    expect(screen.getByTestId('pcl-run-actsub')).toBeDisabled();
    expect(runDemo).not.toHaveBeenCalled();
  });

  it('a missing PingFederate secret is shown on both PingFederate steps and their runs are off', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    getState.mockResolvedValue({ status: 200, data: { configured: false } });
    page();
    await waitFor(() => expect(screen.getAllByTestId('pcl-not-configured')).toHaveLength(2));
    expect(screen.getByTestId('pcl-run-scope')).toBeDisabled();
    expect(screen.getByTestId('pcl-run-actsub')).toBeDisabled();
  });

  it('a 401 on a run turns into the sign-in strip', async () => {
    mockSignedIn();
    runDemo.mockResolvedValue({ status: 401, data: {} });
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
    expect(await screen.findByText(/Sign in to the demo app to mint a PingFederate token/)).toBeInTheDocument();
    expect(screen.getByTestId('pcl-run-scope')).toBeDisabled();
  });
});

describe('PrivilegeCedarLivePage (live): step 1, hold for a human', () => {
  it('shows a running state with the button aria-disabled, then the real approval id and the console instruction', async () => {
    mockSignedIn();
    let release;
    runTool.mockReturnValueOnce(new Promise((r) => { release = r; }));
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    await waitFor(() => expect(screen.getByTestId('pcl-run-hold')).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('pcl-run-hold')).toHaveTextContent('Calling the gateway');
    expect(runTool).toHaveBeenCalledWith('SearchIndexTool', expect.objectContaining({ index: '*' }));
    release(HOLD);
    const verdict = await screen.findByTestId('pcl-hold-verdict');
    expect(verdict).toHaveAttribute('data-outcome', 'hold');
    expect(verdict).toHaveAttribute('data-state', 'held');
    expect(screen.getByTestId('pcl-ins')).toHaveTextContent('ins_0123456789abcdef');
    expect(screen.getByTestId('pcl-hold')).toHaveTextContent(/Access Request Approvals/);
  });

  it('hold, approve, retry: the retry is allowed and reads as the expected end', async () => {
    mockSignedIn();
    runTool.mockResolvedValueOnce(HOLD).mockResolvedValueOnce(ALLOW);
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    fireEvent.click(await screen.findByTestId('pcl-retry'));
    await waitFor(() => expect(screen.getByTestId('pcl-hold-verdict')).toHaveAttribute('data-outcome', 'allow'));
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('pcl-hold-summary')).toHaveTextContent('Allowed on retry');
    expect(screen.queryByTestId('pcl-retry')).toBeNull();
    // The page cannot see an approval, so it must not claim one happened.
    expect(screen.getByTestId('pcl-step-hold')).not.toHaveTextContent(/once approved/i);
  });

  it('a first run that is simply ALLOWED is NOT HELD and never the gate working', async () => {
    mockSignedIn();
    runTool.mockResolvedValue(ALLOW);
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    const summary = await screen.findByTestId('pcl-hold-summary');
    expect(summary).toHaveTextContent('NOT HELD');
    expect(summary).toHaveTextContent('This is not the gate working.');
    expect(screen.queryByTestId('pcl-retry')).toBeNull();
  });

  it('a sign-in answer from the call moves the door back to the sign-in state', async () => {
    mockSignedIn();
    runTool.mockResolvedValue({ outcome: 'signin', detail: 'expired', raw: { error: 'expired', status: 401 } });
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'signin'));
    expect(screen.getByTestId('pcl-hold-summary')).toHaveTextContent('Sign in first');
    expect(screen.getByTestId('pcl-run-hold')).toBeDisabled();
  });

  it.each([
    ['a denial', { outcome: 'deny', detail: 'Forbidden', raw: { error: 'Forbidden', status: 403 } }, 'DENIED'],
    ['an error', { outcome: 'error', detail: 'boom', raw: { error: 'boom' } }, 'ERROR'],
  ])('%s is reported as the pattern not seen, not as a hold', async (_n, result, word) => {
    mockSignedIn();
    runTool.mockResolvedValue(result);
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    const summary = await screen.findByTestId('pcl-hold-summary');
    expect(summary).toHaveTextContent('EXPECTED PATTERN NOT SEEN');
    expect(summary).toHaveTextContent(`got ${word}`);
  });
});

describe('PrivilegeCedarLivePage (live): step 2, token-scope gate', () => {
  const runScope = async (response) => {
    mockSignedIn();
    runDemo.mockResolvedValue(response);
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
  };

  it('shows ENFORCING with both verdicts when the token without the scope is refused and the other allowed', async () => {
    await runScope(withRun({}));
    const result = await screen.findByTestId('pcl-scope-result');
    expect(result).toHaveAttribute('data-state', 'enforcing');
    expect(screen.getByTestId('pcl-scope-summary')).toHaveTextContent('ENFORCING');
    expect(screen.getByTestId('pcl-scope-without')).toHaveTextContent('BLOCKED BY CEDAR');
    expect(screen.getByTestId('pcl-scope-without')).toHaveTextContent('needs the opensearch:search scope');
    expect(screen.getByTestId('pcl-scope-with')).toHaveAttribute('data-verdict', 'allowed');
  });

  it('says no policy was enforcing when both tokens are allowed, and does not call it the gate working', async () => {
    await runScope(withRun({ cedar: [{ ...SCOPE_OK, key: 'without', scope: 'opensearch:admin' }, SCOPE_OK] }));
    const summary = await screen.findByTestId('pcl-scope-summary');
    expect(summary).toHaveTextContent('NOT ENFORCING');
    expect(summary).toHaveTextContent('No scope policy was enforcing on this door when this ran');
    expect(summary).toHaveTextContent('This is not the gate working.');
    expect(summary).not.toHaveTextContent('ENFORCING: ');
  });

  it('any other pattern is EXPECTED PATTERN NOT SEEN', async () => {
    await runScope(withRun({ cedar: [{ ...SCOPE_BLOCKED, key: 'without' }, { ...SCOPE_BLOCKED, key: 'with' }] }));
    expect(await screen.findByTestId('pcl-scope-summary')).toHaveTextContent('EXPECTED PATTERN NOT SEEN');
  });

  it('a run with no cedar section says the api-server may predate the check', async () => {
    await runScope(withRun({ cedar: undefined }));
    expect(await screen.findByTestId('pcl-scope-summary')).toHaveTextContent('may predate this check');
  });

  it('shows a mint failure in words instead of a verdict', async () => {
    await runScope({ status: 200, data: { at: 'now', mint: { status: 401, error: 'invalid_client' } } });
    expect(await screen.findAllByTestId('pcl-mint-error')).toHaveLength(1);
    expect(screen.getByTestId('pcl-mint-error')).toHaveTextContent('invalid_client');
    expect(screen.queryByTestId('pcl-scope-result')).toBeNull();
  });

  it.each([
    ['a 500', 500, {}, 'did not return a result (HTTP 500)'],
    ['a 503', 503, {}, 'PF_TOKEN_DEMO_CLIENT_SECRET'],
  ])('%s is an error state and the button works again', async (_n, status, data, text) => {
    await runScope({ status, data });
    const problem = await screen.findByTestId('pcl-run-scope-problem');
    expect(problem).toHaveTextContent(text);
    expect(problem).toHaveTextContent('Failed');
    expect(screen.queryByTestId('pcl-scope-result')).toBeNull();
    expect(screen.getByTestId('pcl-run-scope')).toBeEnabled();
  });

  it('a thrown request is shown as the problem', async () => {
    mockSignedIn();
    runDemo.mockRejectedValue(new Error('socket hang up'));
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
    expect(await screen.findByTestId('pcl-run-scope-problem')).toHaveTextContent('socket hang up');
  });

  it('is aria-disabled while running and clears the previous result when it runs again', async () => {
    mockSignedIn();
    let release;
    runDemo.mockResolvedValueOnce(withRun({})).mockReturnValueOnce(new Promise((r) => { release = r; }));
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
    await screen.findByTestId('pcl-scope-result');
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
    await waitFor(() => expect(screen.getByTestId('pcl-run-scope')).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('pcl-run-scope')).toHaveTextContent('Running');
    expect(screen.queryByTestId('pcl-scope-result')).toBeNull();
    release(withRun({}));
    await screen.findByTestId('pcl-scope-result');
  });
});

describe('PrivilegeCedarLivePage (live): step 3, agent act.sub gate', () => {
  const runAct = async (response) => {
    mockSignedIn();
    runDemo.mockResolvedValue(response);
    await readyPage();
    fireEvent.click(screen.getByTestId('pcl-run-actsub'));
  };

  it('shows ENFORCING, the claim the policy read and one verdict per tool', async () => {
    await runAct(withRun({}));
    const result = await screen.findByTestId('ppt-actsub-result');
    expect(result).toHaveAttribute('data-enforcing', 'true');
    expect(screen.getByTestId('ppt-actsub-summary')).toHaveTextContent('ENFORCING');
    expect(screen.getByTestId('ppt-actsub-claim')).toHaveTextContent('agent-client');
    expect(screen.getByTestId('ppt-actsub-CountTool')).toHaveAttribute('data-verdict', 'allowed');
    expect(screen.getByTestId('ppt-actsub-ListIndexTool')).toHaveAttribute('data-verdict', 'blocked-by-cedar');
    expect(screen.getByTestId('ppt-actsub-ListIndexTool')).toHaveTextContent('requires act.sub to be some-other-agent');
  });

  it('says no act.sub policy was enforcing when both tools answer allowed, never the gate working', async () => {
    await runAct(withRun({ actSub: { claim: CLAIM, tools: [COUNT_OK, LIST_OK], enforcing: false } }));
    const summary = await screen.findByTestId('ppt-actsub-summary');
    expect(summary).toHaveTextContent('NOT ENFORCING');
    expect(summary).toHaveTextContent('No act.sub policy was enforcing on this door when this ran');
    expect(summary).toHaveTextContent('This is not the gate working.');
    expect(screen.getByTestId('ppt-actsub-result')).toHaveAttribute('data-enforcing', 'false');
  });

  it.each([
    ['reversed', [{ ...COUNT_OK, verdict: 'blocked-by-cedar', status: 400, message: 'action denied by policy: x' }, LIST_OK]],
    ['a rejected token', [{ ...COUNT_OK, verdict: 'token-rejected', status: 401 }, { ...LIST_OK, verdict: 'token-rejected', status: 401 }]],
    ['an error', [COUNT_OK, { ...LIST_OK, verdict: 'error', status: 500, message: 'boom' }]],
  ])('%s is EXPECTED PATTERN NOT SEEN', async (_n, tools) => {
    await runAct(withRun({ actSub: { claim: CLAIM, tools, enforcing: false } }));
    expect(await screen.findByTestId('ppt-actsub-summary')).toHaveTextContent('EXPECTED PATTERN NOT SEEN');
  });

  it('a run with no actSub says the api-server may predate the check', async () => {
    await runAct(withRun({ actSub: undefined }));
    expect(await screen.findByTestId('pcl-actsub-empty')).toHaveTextContent('may predate this check');
    expect(screen.queryByTestId('ppt-actsub-result')).toBeNull();
  });

  it('a mint failure is shown in words and no act.sub verdict', async () => {
    await runAct({ status: 200, data: { at: 'now', mint: { status: 400, error: 'unauthorized_client' } } });
    expect(await screen.findByTestId('pcl-mint-error')).toHaveTextContent('unauthorized_client');
    expect(screen.queryByTestId('ppt-actsub-result')).toBeNull();
  });

  it('a 500 is an error state', async () => {
    await runAct({ status: 500, data: { error: 'upstream_failed', message: 'The gateway timed out.' } });
    expect(await screen.findByTestId('pcl-run-actsub-problem')).toHaveTextContent('The gateway timed out.');
  });

  it('never shows the token itself', async () => {
    await runAct(withRun({}));
    await screen.findByTestId('ppt-actsub-result');
    expect(document.body.textContent).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe('PrivilegeCedarLivePage (live): one primary action', () => {
  it('moves the primary along the tour as each step has its result', async () => {
    mockSignedIn();
    runTool.mockResolvedValue(HOLD);
    runDemo.mockResolvedValue(withRun({}));
    await readyPage();
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toBe(screen.getByTestId('pcl-run-hold'));
    fireEvent.click(screen.getByTestId('pcl-run-hold'));
    await screen.findByTestId('pcl-retry');
    expect(primaries()).toEqual([screen.getByTestId('pcl-retry')]);
    runTool.mockResolvedValue(ALLOW);
    fireEvent.click(screen.getByTestId('pcl-retry'));
    await waitFor(() => expect(screen.getByTestId('pcl-hold-summary')).toHaveTextContent('Allowed on retry'));
    expect(primaries()).toEqual([screen.getByTestId('pcl-run-scope')]);
    fireEvent.click(screen.getByTestId('pcl-run-scope'));
    await screen.findByTestId('pcl-scope-result');
    expect(primaries()).toEqual([screen.getByTestId('pcl-run-actsub')]);
    fireEvent.click(screen.getByTestId('pcl-run-actsub'));
    await screen.findByTestId('ppt-actsub-result');
    expect(primaries()).toHaveLength(0);
  });

  it('with nothing able to run, the primary is Check again', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: false });
    getState.mockResolvedValue({ status: 200, data: { configured: false } });
    page();
    await waitFor(() => expect(screen.getByTestId('pcl-conn')).toHaveAttribute('data-status', 'signin'));
    await waitFor(() => expect(screen.getAllByTestId('pcl-not-configured')).toHaveLength(2));
    expect(primaries()).toEqual([screen.getByTestId('pcl-connect')]);
  });
});

describe('PrivilegeCedarLivePage (walkthrough twin, live=false)', () => {
  it('makes no calls, has no buttons and shows no live result', () => {
    page({ live: false });
    expect(connectDoor).not.toHaveBeenCalled();
    expect(getState).not.toHaveBeenCalled();
    expect(runTool).not.toHaveBeenCalled();
    expect(runDemo).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    for (const id of ['pcl-conn', 'pcl-hold-verdict', 'pcl-scope-result', 'ppt-actsub-result', 'pcl-run-hold', 'pcl-run-scope', 'pcl-run-actsub']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.getByTestId('pcl-banner')).toHaveTextContent('WALKTHROUGH, NO CALLS');
  });

  it('still shows the expectation and the Cedar of each step, and points at the live tour', () => {
    page({ live: false });
    expect(screen.getByTestId('pcl-step-hold')).toHaveTextContent('Expected from the gateway');
    expect(screen.getByTestId('pcl-step-hold')).toHaveTextContent('HELD');
    expect(screen.getByTestId('pcl-step-scope')).toHaveTextContent('BLOCKED BY CEDAR, then ALLOWED');
    expect(screen.getByTestId('pcl-step-actsub')).toHaveTextContent('ALLOWED, then BLOCKED BY CEDAR');
    expect(screen.getByTestId('pcl-policy-pftoken-scope-search')).toHaveTextContent('console copy read 2026-11-16');
    expect(screen.getByTestId('pcl-measured')).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/privilege-cedar-live');
  });
});
