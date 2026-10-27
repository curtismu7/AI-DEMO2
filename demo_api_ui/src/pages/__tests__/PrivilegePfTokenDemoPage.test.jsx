import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

  it('puts every section in a collapsible, open by default', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    render(<PrivilegePfTokenDemoPage />);
    for (const id of ['run', 'scope', 'setup', 'fail', 'flow']) {
      const section = screen.getByTestId(`ppt-section-${id}`);
      expect(section.tagName).toBe('DETAILS');
      expect(section).toHaveAttribute('open');
      expect(section.querySelector(':scope > summary h2')).not.toBeNull();
    }
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
