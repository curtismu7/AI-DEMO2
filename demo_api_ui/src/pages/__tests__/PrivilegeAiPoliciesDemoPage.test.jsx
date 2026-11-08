import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/privilegeAiPoliciesDemoService', () => ({ connectDoor: vi.fn(), runTool: vi.fn() }));
import { connectDoor, runTool } from '../../services/privilegeAiPoliciesDemoService';
import PrivilegeAiPoliciesDemoPage from '../PrivilegeAiPoliciesDemoPage';

// @xyflow/react observes its container's size; jsdom has no ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const page = (props) => render(<MemoryRouter><PrivilegeAiPoliciesDemoPage {...props} /></MemoryRouter>);
const HOLD = { outcome: 'hold', instructionId: 'ins_0123456789abcdef', detail: 'pending_approval', raw: { result: { content: [{ text: 'pending_approval ins_0123456789abcdef' }] } } };
const ALLOW = { outcome: 'allow', detail: 'index-a', raw: { result: { content: [{ text: 'index-a' }] } } };
const DENY = { outcome: 'deny', detail: 'Forbidden', raw: { error: 'Forbidden', status: 403 } };

beforeEach(() => { vi.resetAllMocks(); });

describe('PrivilegeAiPoliciesDemoPage (live)', () => {
  it('says plainly that the decisions come from the gateway and the page runs no Cedar engine', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    page();
    expect(screen.getByTestId('apd-banner')).toHaveTextContent(/comes from the Privilege gateway/);
    expect(screen.getByTestId('apd-banner')).toHaveTextContent(/runs no Cedar engine/);
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'ready'));
  });

  it('hold then approve then retry: shows the real approval id, tells you to approve in the console, and a retry goes through', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValueOnce(HOLD).mockResolvedValueOnce(ALLOW);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-hold')).toBeEnabled());
    fireEvent.click(screen.getByTestId('apd-run-hold'));
    const scn = screen.getByTestId('apd-scn-hold');
    await waitFor(() => expect(within(scn).getByTestId('apd-verdict')).toHaveAttribute('data-outcome', 'hold'));
    expect(runTool).toHaveBeenCalledWith('SearchIndexTool', expect.objectContaining({ index: '*' }));
    expect(within(scn).getByTestId('apd-ins')).toHaveTextContent('ins_0123456789abcdef');
    expect(within(scn).getByTestId('apd-hold')).toHaveTextContent(/Access Request Approvals/);
    expect(within(scn).getByText('Matches what was expected.')).toBeInTheDocument();
    fireEvent.click(within(scn).getByTestId('apd-retry'));
    await waitFor(() => expect(within(scn).getByTestId('apd-verdict')).toHaveAttribute('data-outcome', 'allow'));
    expect(runTool).toHaveBeenCalledTimes(2);
    expect(within(scn).getByTestId('apd-changed')).toHaveTextContent(/HELD.*ALLOWED/);
  });

  it('shows no change note when the gateway answers the same as last time', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValue(DENY);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-deny')).toBeEnabled());
    fireEvent.click(screen.getByTestId('apd-run-deny'));
    await waitFor(() => expect(within(screen.getByTestId('apd-scn-deny')).getByTestId('apd-verdict')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('apd-run-deny'));
    await waitFor(() => expect(runTool).toHaveBeenCalledTimes(2));
    expect(within(screen.getByTestId('apd-scn-deny')).queryByTestId('apd-changed')).toBeNull();
  });

  it('hard deny: runs the unrestricted API tool and shows the gateway refusal with the real policy beside it', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValue(DENY);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-deny')).toBeEnabled());
    fireEvent.click(screen.getByTestId('apd-run-deny'));
    const scn = screen.getByTestId('apd-scn-deny');
    await waitFor(() => expect(within(scn).getByTestId('apd-verdict')).toHaveAttribute('data-outcome', 'deny'));
    expect(runTool).toHaveBeenCalledWith('GenericOpenSearchApiTool', expect.any(Object));
    const policy = within(scn).getByTestId('apd-policy-hitl-block-generic-api');
    expect(policy).toHaveTextContent('Active');
    expect(policy.querySelector('.pu-chip--ok')).not.toBeNull();
    expect(policy).toHaveTextContent('Tool::"GenericOpenSearchApiTool"');
    expect(within(scn).getByText(/Raw response|raw response/i)).toBeInTheDocument();
  });

  it('not signed in: run buttons stay disabled and the page points at the Privilege client to sign in', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: false });
    page();
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'signin'));
    expect(screen.getByTestId('apd-run-hold')).toBeDisabled();
    expect(screen.getByRole('link', { name: /Open the Privilege client/ })).toHaveAttribute('href', '/privilege-mcp-client');
  });

  it('a call answered 401 flips the page back to sign-in instead of pretending it ran', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValue({ outcome: 'signin', detail: 'Not authenticated', raw: {} });
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-allow')).toBeEnabled());
    fireEvent.click(screen.getByTestId('apd-run-allow'));
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'signin'));
  });

  it('a missing door is reported, not guessed', async () => {
    connectDoor.mockResolvedValue({ ok: false, reason: 'no-door' });
    page();
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'nodoor'));
    expect(screen.getByTestId('apd-run-hold')).toBeDisabled();
  });

  it('the PF-agent scenario is marked measured and links to its own demo page, with no run button here', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    page();
    const pf = screen.getByTestId('apd-scn-pf-agent');
    expect(pf).toHaveTextContent('Measured 2026-10-27');
    expect(within(pf).getByTestId('apd-pf-link')).toHaveAttribute('href', '/privilege-pf-token');
    expect(within(pf).queryByRole('button')).toBeNull();
  });
});

describe('Options lab: change an option, see the Cedar and the impact', () => {
  const lab = () => screen.getByTestId('apd-lab');
  const row = (k) => within(lab()).getByTestId(`apd-impact-${k}`);

  it('starts on the live hold rule: its Cedar is the live policy and nothing changes', () => {
    page({ live: false });
    expect(within(lab()).getByTestId('apd-lab-cedar')).toHaveTextContent('Action::"mcp:InvokeUnattended"');
    expect(within(lab()).getByTestId('apd-lab-cedar')).toHaveTextContent('Tool::"SearchIndexTool"');
    expect(['hold', 'deny', 'allow'].every((k) => row(k).getAttribute('data-changed') === 'no')).toBe(true);
    expect(within(lab()).getByTestId('apd-lab-nochange')).toBeInTheDocument();
    expect(within(lab()).getByTestId('apd-lab-honest')).toHaveTextContent(/prediction/);
  });

  it('switching the outcome to refuse rewrites the Cedar to mcp:Invoke and makes the search DENIED', () => {
    page({ live: false });
    fireEvent.change(within(lab()).getByTestId('apd-lab-outcome'), { target: { value: 'refuse' } });
    expect(within(lab()).getByTestId('apd-lab-cedar')).toHaveTextContent('Action::"mcp:Invoke"');
    expect(within(lab()).getByTestId('apd-lab-cedar')).not.toHaveTextContent('@approvers');
    expect(row('hold')).toHaveAttribute('data-changed', 'yes');
    expect(row('hold')).toHaveTextContent(/DENIED.*changed/);
    expect(row('deny')).toHaveAttribute('data-changed', 'no');
  });

  it('saving as a Candidate says it is never enforced and the search falls back to ALLOWED', () => {
    page({ live: false });
    fireEvent.change(within(lab()).getByTestId('apd-lab-state'), { target: { value: 'Candidate' } });
    expect(within(lab()).getByTestId('apd-lab-candidate')).toHaveTextContent(/never enforced/);
    expect(row('hold')).toHaveTextContent(/ALLOWED.*changed/);
  });

  it('dropping the unless condition warns that approval never lifts the hold, and the after-approval column stays HELD', () => {
    page({ live: false });
    fireEvent.click(within(lab()).getByTestId('apd-lab-lifts'));
    expect(within(lab()).getByTestId('apd-lab-nolift')).toHaveTextContent(/refuses the approval it asked for/);
    expect(within(lab()).getByTestId('apd-lab-cedar')).not.toHaveTextContent('unless');
    expect(row('hold')).toHaveAttribute('data-changed', 'yes');
    expect(row('hold').querySelectorAll('td')[3]).toHaveTextContent('HELD');
    expect(row('hold')).toHaveTextContent(/same, but approval no longer lifts it/);
    expect(row('hold')).not.toHaveTextContent(/HELD \(changed\)/);
  });

  it('a new rule on ListIndexTool changes the allowed scenario, and the make-it-real steps name the console path', () => {
    page({ live: false });
    fireEvent.change(within(lab()).getByTestId('apd-lab-rule'), { target: { value: 'new' } });
    fireEvent.change(within(lab()).getByTestId('apd-lab-tool'), { target: { value: 'ListIndexTool' } });
    expect(row('allow')).toHaveAttribute('data-changed', 'yes');
    expect(row('allow')).toHaveTextContent(/DENIED.*changed/);
    expect(lab()).toHaveTextContent(/Access Management → AI Policies/);
    expect(lab()).toHaveTextContent(/Save as Candidate|Candidate first/);
  });

  it('every option note says how we know it', () => {
    page({ live: false });
    for (const tag of ['measured', 'console-text', 'inferred']) expect(within(lab()).getAllByText(tag).length).toBeGreaterThan(0);
  });
});

describe('PrivilegeAiPoliciesDemoPage (standalone walkthrough)', () => {
  it('has no connect panel and no run buttons, never calls the gateway, and links to the live page', () => {
    page({ live: false });
    expect(screen.queryByTestId('apd-conn')).toBeNull();
    expect(screen.queryByTestId('apd-run-hold')).toBeNull();
    expect(connectDoor).not.toHaveBeenCalled();
    expect(runTool).not.toHaveBeenCalled();
    expect(screen.getAllByRole('link', { name: /open the demo inside the app/i })[0]).toHaveAttribute('href', '/privilege-ai-policies');
    expect(screen.getByTestId('apd-scn-hold')).toHaveTextContent(/Expected from the gateway/);
    expect(screen.queryByTestId('apd-verdict')).toBeNull();
  });

  it('shows what Privilege policies can read, without any demo-only attributes, and embeds the diagram', () => {
    page({ live: false });
    const vocab = screen.getByTestId('apd-vocab');
    expect(within(vocab).getByText('context.token.scopes')).toBeInTheDocument();
    expect(vocab).not.toHaveTextContent(/pinnedHash|observedHash|client_id/);
    expect(screen.getByTestId('apd-diagram')).toBeInTheDocument();
  });
});

describe('Ping UI Standard: banner, chips, one primary per view state', () => {
  const primaries = () => [...document.querySelectorAll('.pu-btn--primary')];
  const primaryIds = () => primaries().map((b) => b.getAttribute('data-testid') || b.textContent.trim());

  it('the banner is a note and the first thing in the page, and says what is real and what is not', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    page();
    const banner = screen.getByTestId('apd-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(screen.getByTestId('apd-page').firstElementChild).toContainElement(banner);
    expect(banner).toHaveTextContent(/Real:.*scenario runs/);
    expect(banner).toHaveTextContent(/Not real:.*mirror.*prediction.*Simulate button only animates/);
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'ready'));
  });

  it('the walkthrough banner admits no call is made and shows no gateway decision', () => {
    page({ live: false });
    const banner = screen.getByTestId('apd-banner');
    expect(banner).toHaveTextContent(/WALKTHROUGH, NO CALLS/);
    expect(banner).not.toHaveTextContent(/comes from the Privilege gateway/);
  });

  it('exactly one primary while connecting, and it is the disabled Check again', () => {
    connectDoor.mockReturnValue(new Promise(() => {}));
    page();
    expect(primaries()).toHaveLength(1);
    expect(primaries()[0]).toHaveTextContent('Check again');
    expect(primaries()[0]).toHaveAttribute('aria-disabled', 'true');
  });

  it('a button pressed while a call is in flight keeps keyboard focus (aria-disabled, never disabled) and ignores a second press', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockReturnValue(new Promise(() => {}));
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-hold')).toBeEnabled());
    const run = screen.getByTestId('apd-run-hold');
    run.focus();
    fireEvent.click(run);
    await waitFor(() => expect(run).toHaveTextContent('Calling the gateway…'));
    expect(run).not.toBeDisabled();
    expect(run).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(run);
    fireEvent.click(run);
    expect(runTool).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['signin', { ok: true, url: 'u', authenticated: false }],
    ['nodoor', { ok: false, reason: 'no-door' }],
  ])('exactly one primary when the door state is %s: Check again, and every Run is a secondary', async (status, reply) => {
    connectDoor.mockResolvedValue(reply);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', status));
    expect(primaryIds()).toEqual(['Check again']);
    expect(screen.getByTestId('apd-run-hold')).not.toHaveClass('pu-btn--primary');
  });

  it('exactly one primary when the client cannot be reached', async () => {
    connectDoor.mockRejectedValue(Object.assign(new Error('down'), { status: 502 }));
    page();
    await waitFor(() => expect(screen.getByTestId('apd-conn')).toHaveAttribute('data-status', 'error'));
    expect(primaryIds()).toEqual(['Check again']);
  });

  it('the primary follows the flow: first Run, then Retry while HELD, then the next unrun scenario', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValueOnce(HOLD).mockResolvedValueOnce(ALLOW);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-hold')).toBeEnabled());
    expect(primaryIds()).toEqual(['apd-run-hold']);
    expect(screen.getByText('Check again')).not.toHaveClass('pu-btn--primary');

    fireEvent.click(screen.getByTestId('apd-run-hold'));
    await waitFor(() => expect(screen.getByTestId('apd-retry')).toBeInTheDocument());
    expect(primaryIds()).toEqual(['apd-retry']);
    expect(screen.getByTestId('apd-run-hold')).not.toHaveClass('pu-btn--primary');

    fireEvent.click(screen.getByTestId('apd-retry'));
    await waitFor(() => expect(within(screen.getByTestId('apd-scn-hold')).getByTestId('apd-verdict')).toHaveAttribute('data-outcome', 'allow'));
    expect(screen.queryByTestId('apd-retry')).toBeNull();
    expect(primaryIds()).toEqual(['apd-run-deny']);
  });

  it('the walkthrough has no page buttons at all, so no primary', () => {
    page({ live: false });
    expect(primaries()).toHaveLength(0);
    expect(within(screen.getByTestId('apd-scn-hold')).queryByRole('button')).toBeNull();
  });

  it('every run control is a real button with its own accessible name, and the lab controls are labelled (keyboard)', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-hold')).toBeEnabled());
    for (const s of ['Hold for a human, then approve and retry']) {
      expect(screen.getByRole('button', { name: `Run through Privilege: ${s}` })).toBe(screen.getByTestId('apd-run-hold'));
    }
    expect(screen.getAllByRole('button', { name: /^Run through Privilege: / })).toHaveLength(3);
    for (const label of ['Rule to change', 'Outcome', 'Target: one named tool', 'Save as']) {
      expect(screen.getByLabelText(label).tagName).toBe('SELECT');
    }
    // Scrollable code blocks can be reached and read without a mouse.
    const cedar = screen.getByTestId('apd-lab-cedar');
    expect(cedar).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('region', { name: 'Cedar this will save' })).toBe(cedar);
  });

  it('every status chip carries a word, and the lab never presents a prediction as a gateway answer', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    runTool.mockResolvedValue(DENY);
    page();
    await waitFor(() => expect(screen.getByTestId('apd-run-deny')).toBeEnabled());
    fireEvent.click(screen.getByTestId('apd-run-deny'));
    await waitFor(() => expect(screen.getByTestId('apd-verdict')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('apd-lab-state'), { target: { value: 'Candidate' } });
    const chips = [...document.querySelectorAll('.pu-chip')];
    expect(chips.length).toBeGreaterThan(5);
    for (const c of chips) expect(c.textContent.trim().length).toBeGreaterThan(0);
    // The real verdict chip says DENIED; nothing in the lab is titled or labelled as a gateway answer.
    expect(within(screen.getByTestId('apd-verdict')).getByText('DENIED')).toHaveClass('pu-chip');
    const lab = screen.getByTestId('apd-lab');
    for (const h of lab.querySelectorAll('h2, h3, caption, th')) expect(h.textContent).not.toMatch(/^\s*Gateway/i);
    expect(within(lab).getByText('Prediction')).toHaveClass('pu-chip');
    expect(within(lab).queryByTestId('apd-verdict')).toBeNull();
  });
});
