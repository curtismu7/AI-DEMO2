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

  it('the PF-agent scenario is marked not proven and has no run button', async () => {
    connectDoor.mockResolvedValue({ ok: true, url: 'u', authenticated: true });
    page();
    const pf = screen.getByTestId('apd-scn-pf-agent');
    expect(pf).toHaveTextContent('Not proven');
    expect(within(pf).queryByRole('button')).toBeNull();
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
