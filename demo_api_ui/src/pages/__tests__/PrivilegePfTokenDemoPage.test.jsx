import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/privilegePfTokenDemoService', () => ({ getState: vi.fn(), runDemo: vi.fn() }));
import { getState, runDemo } from '../../services/privilegePfTokenDemoService';
import PrivilegePfTokenDemoPage from '../PrivilegePfTokenDemoPage';

// @xyflow/react observes its container's size; jsdom has no ResizeObserver.
global.ResizeObserver = global.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} };

const STATE = { configured: true, issuer: 'https://cmuir-pf.ping-devops.com', clientId: 'pf-route-c-test', doorUrl: 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp' };
const PASS = {
  at: '2026-10-26T18:12:44.473Z',
  mint: { status: 200, claims: { iss: 'https://cmuir-pf.ping-devops.com', sub: 'pf-route-c-test', act: { sub: 'pf-route-c-test' }, jti: 'abc' } },
  pfToken: { status: 200, verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'], detail: '' },
  garbage: { status: 401, verdict: 'token-rejected', tools: [], detail: 'Bearer token required' },
  tiers: [
    { key: 'full', scope: 'openid opensearch:admin whoami:read', status: 200, verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'] },
    { key: 'read', scope: 'openid opensearch:read', status: 200, verdict: 'allowed', tools: ['ListIndexTool'] },
    { key: 'none', scope: 'openid whoami:read', status: 403, verdict: 'refused-by-policy', tools: [], detail: 'Forbidden' },
  ],
  cedar: [
    { key: 'without', scope: 'openid opensearch:admin', status: 400, verdict: 'blocked-by-cedar', message: "action denied by policy: SearchIndexTool needs the opensearch:search scope in the agent's token" },
    { key: 'with', scope: 'openid opensearch:admin opensearch:search', status: 200, verdict: 'allowed', message: 'search ran (935 documents matched)' },
  ],
  backend: { status: 200, verdict: 'allowed', detail: '', received: { issuer: 'https://cmuir-pf.ping-devops.com', claims: { iss: 'https://cmuir-pf.ping-devops.com', sub: 'pf-route-c-test', act: { sub: 'pf-route-c-test' }, jti: 'abc' } } },
};

beforeEach(() => { vi.resetAllMocks(); });

describe('PrivilegePfTokenDemoPage', () => {
  it('runs: shows the claims, the allowed answer with its tools, and the rejected control', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: PASS });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    expect(screen.getByTestId('ppt-target')).toHaveTextContent('pf-route-c-test');
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-result')).toBeInTheDocument());
    expect(screen.getByTestId('ppt-claims')).toHaveTextContent('"act"');
    const pf = screen.getByTestId('ppt-answer-pf');
    expect(pf).toHaveAttribute('data-verdict', 'allowed');
    expect(within(pf).getByText('ListIndexTool')).toBeInTheDocument();
    expect(screen.getByTestId('ppt-answer-garbage')).toHaveAttribute('data-verdict', 'token-rejected');
    expect(screen.getByTestId('ppt-backend')).toHaveTextContent('What the backend received');
    expect(screen.getByTestId('ppt-tier-full')).toHaveTextContent('2: ListIndexTool, SearchIndexTool');
    expect(screen.getByTestId('ppt-tier-read')).toHaveAttribute('data-verdict', 'allowed');
    expect(screen.getByTestId('ppt-tier-none')).toHaveTextContent('REFUSED BY POLICY');
    expect(screen.getByTestId('ppt-cedar-without')).toHaveTextContent('BLOCKED BY CEDAR');
    expect(screen.getByTestId('ppt-cedar-with')).toHaveAttribute('data-verdict', 'allowed');
    expect(screen.getByTestId('ppt-cedar')).toHaveTextContent('context.token.scopes.contains');
    expect(screen.getByTestId('ppt-backend-iss')).toHaveAttribute('data-same', 'true');
    expect(screen.getByTestId('ppt-backend-act')).toHaveAttribute('data-same', 'true');
    expect(screen.getByTestId('ppt-backend-jti')).toHaveAttribute('data-same', 'true');
  });

  it('falls back to the named fields from an older whoami that sends no claims', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: { ...PASS, backend: { status: 200, verdict: 'allowed', detail: '', received: { issuer: 'https://cmuir-pf.ping-devops.com', subject: 'pf-route-c-test' } } } });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-backend-iss')).toHaveAttribute('data-same', 'true'));
    expect(screen.getByTestId('ppt-backend-jti')).toHaveAttribute('data-same', 'false');
  });

  it('shows the gateway answer in place of the backend table when whoami was refused', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: { ...PASS, backend: { status: 403, verdict: 'refused-by-policy', received: null, detail: 'Forbidden' } } });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-backend')).toHaveAttribute('data-verdict', 'refused-by-policy'));
    expect(screen.queryByTestId('ppt-backend-iss')).toBeNull();
  });

  it('labels a 403 as refused by policy', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: { ...PASS, pfToken: { status: 403, verdict: 'refused-by-policy', tools: [], detail: 'Forbidden' } } });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-answer-pf')).toHaveTextContent('REFUSED BY POLICY'));
  });

  it('turns the run button off when the BFF has no client secret', async () => {
    getState.mockResolvedValue({ status: 200, data: { ...STATE, configured: false } });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-not-configured')).toBeInTheDocument());
    expect(screen.getByTestId('ppt-run')).toBeDisabled();
  });

  it('asks to sign in when the run is refused for no session', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 401, data: {} });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByText('Sign in required')).toBeInTheDocument());
  });

  it('shows a sign-in prompt, not "not configured", when the state call is refused for no session', async () => {
    getState.mockResolvedValue({ status: 401, data: { error: 'hosted_access_required' } });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByText('Sign in required')).toBeInTheDocument());
    expect(screen.queryByTestId('ppt-not-configured')).toBeNull();
    expect(screen.queryByTestId('ppt-target')).toBeNull();
    expect(screen.getByTestId('ppt-run')).toBeDisabled();
  });

  it('keeps the reference sections collapsible, open by default, and the run and path sections always visible', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    render(<PrivilegePfTokenDemoPage />);
    for (const id of ['scope', 'setup', 'fail']) {
      const section = screen.getByTestId(`ppt-section-${id}`);
      expect(section.tagName).toBe('DETAILS');
      expect(section).toHaveAttribute('open');
      expect(section.querySelector(':scope > summary')).not.toBeNull();
      expect(section.closest('section')).toHaveAccessibleName();
    }
    for (const id of ['run', 'flow']) expect(screen.getByTestId(`ppt-section-${id}`).closest('section')).toHaveAccessibleName();
  });

  it('shows the working setup, the failure table and the diagram without running anything', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    render(<PrivilegePfTokenDemoPage />);
    expect(screen.getByTestId('ppt-setup')).toHaveTextContent('act.sub = pf-route-c-test');
    expect(screen.getByTestId('ppt-failures')).toHaveTextContent('policy denied');
    expect(screen.getByTestId('ppt-can')).toHaveTextContent('RequiredClaims on scope');
    expect(screen.getByTestId('ppt-cannot')).toHaveTextContent('Token exchange');
    expect(screen.getByTestId('ppt-diagram')).toBeInTheDocument();
    expect(runDemo).not.toHaveBeenCalled();
  });
});

// Standalone Ping UI Standard (P2, P4, P5, P7, P9) through the shared primitives.
describe('PrivilegePfTokenDemoPage (Ping UI standard)', () => {
  const primaries = (container) => [...container.querySelectorAll('button.pu-btn--primary')];

  it('puts an honest note first: a live run, recorded notes, nothing called when the button is off', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    const { container } = render(<PrivilegePfTokenDemoPage />);
    const banner = screen.getByRole('note');
    expect(container.querySelector('.ppt-page').firstElementChild.contains(banner)).toBe(true);
    expect(banner.textContent).toMatch(/not simulated/i);
    expect(banner.textContent).toMatch(/recorded notes/i);
    expect(banner.textContent).toMatch(/nothing\s+is called/i);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('PingFederate token on Privilege');
  });

  it('shows exactly one primary, the Run button, in every state', async () => {
    // signed out
    getState.mockResolvedValue({ status: 401, data: {} });
    const out = render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByText('Sign in required')).toBeInTheDocument());
    expect(primaries(out.container)).toEqual([screen.getByTestId('ppt-run')]);
    expect(screen.getByTestId('ppt-run')).toBeDisabled();
    out.unmount();

    // not configured
    getState.mockResolvedValue({ status: 200, data: { ...STATE, configured: false } });
    const nc = render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-not-configured')).toBeInTheDocument());
    expect(primaries(nc.container)).toEqual([screen.getByTestId('ppt-run')]);
    nc.unmount();

    // idle, running, result: the same element throughout
    getState.mockResolvedValue({ status: 200, data: STATE });
    let finish;
    runDemo.mockReturnValue(new Promise((res) => { finish = res; }));
    const ok = render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    const run = screen.getByTestId('ppt-run');
    expect(primaries(ok.container)).toEqual([run]);
    fireEvent.click(run);
    await waitFor(() => expect(run).toHaveAttribute('aria-disabled', 'true'));
    expect(run).toHaveTextContent('Running');
    fireEvent.click(run); // a second activation while running does not start another run
    expect(runDemo).toHaveBeenCalledTimes(1);
    expect(primaries(ok.container)).toEqual([run]);
    finish({ status: 200, data: PASS });
    await waitFor(() => expect(screen.getByTestId('ppt-result')).toBeInTheDocument());
    expect(screen.getByTestId('ppt-run')).toBe(run);
    expect(primaries(ok.container)).toEqual([run]);
    ok.unmount();

    // error
    runDemo.mockReset();
    runDemo.mockRejectedValue(new Error('network down'));
    const bad = render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-problem')).toHaveTextContent('network down'));
    expect(primaries(bad.container)).toEqual([screen.getByTestId('ppt-run')]);
  });

  it('runs from the keyboard alone: Tab to the Run button, Enter', async () => {
    const user = userEvent.setup();
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: PASS });
    render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    await user.tab();
    expect(screen.getByTestId('ppt-run')).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('ppt-result')).toBeInTheDocument());
    expect(runDemo).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ppt-run')).toHaveFocus(); // still on the Run button after the run
  });

  it('carries every verdict and status as a chip with a word, in cards and kv lists', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    runDemo.mockResolvedValue({ status: 200, data: PASS });
    const { container } = render(<PrivilegePfTokenDemoPage />);
    await waitFor(() => expect(screen.getByTestId('ppt-run')).toBeEnabled());
    expect(screen.getByTestId('ppt-target').querySelector('dl.pu-kv')).not.toBeNull();
    fireEvent.click(screen.getByTestId('ppt-run'));
    await waitFor(() => expect(screen.getByTestId('ppt-result')).toBeInTheDocument());
    for (const chip of container.querySelectorAll('.pu-chip')) expect(chip.textContent.trim().length).toBeGreaterThan(0);
    const pf = screen.getByTestId('ppt-answer-pf');
    expect(pf.className).toContain('pu-card--ok');
    expect(within(pf).getByText('ALLOWED').className).toContain('pu-chip--ok');
    const garbage = screen.getByTestId('ppt-answer-garbage');
    expect(garbage.className).toContain('pu-card--danger');
    expect(within(garbage).getByText('TOKEN REJECTED').className).toContain('pu-chip--danger');
    expect(within(screen.getByTestId('ppt-tier-none')).getByText('REFUSED BY POLICY').className).toContain('pu-chip--danger');
    expect(within(screen.getByTestId('ppt-backend-iss')).getByText('Same').className).toContain('pu-chip--ok');
    // setup and failures are kv cards, one per layer / failure
    expect(screen.getByTestId('ppt-setup').querySelectorAll('.pu-card dl.pu-kv').length).toBeGreaterThanOrEqual(5);
    expect(screen.getByTestId('ppt-failures').querySelectorAll('.pu-card').length).toBeGreaterThanOrEqual(6);
  });
});
