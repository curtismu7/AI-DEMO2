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
  mint: { status: 200, claims: { iss: 'https://cmuir-pf.ping-devops.com', sub: 'pf-route-c-test', act: { sub: 'pf-route-c-test' } } },
  pfToken: { status: 200, verdict: 'allowed', tools: ['ListIndexTool', 'SearchIndexTool'], detail: '' },
  garbage: { status: 401, verdict: 'token-rejected', tools: [], detail: 'Bearer token required' },
  backend: { status: 200, verdict: 'allowed', detail: '', received: { issuer: 'https://cmuir-pf.ping-devops.com', subject: 'pf-route-c-test', actor: { sub: 'pf-route-c-test' } } },
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
    expect(screen.getByTestId('ppt-backend-iss')).toHaveAttribute('data-same', 'true');
    expect(screen.getByTestId('ppt-backend-act')).toHaveAttribute('data-same', 'true');
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
    await waitFor(() => expect(screen.getByTestId('ppt-problem')).toHaveTextContent(/Sign in/));
  });

  it('shows the working setup, the failure table and the diagram without running anything', async () => {
    getState.mockResolvedValue({ status: 200, data: STATE });
    render(<PrivilegePfTokenDemoPage />);
    expect(screen.getByTestId('ppt-setup')).toHaveTextContent('act.sub = pf-route-c-test');
    expect(screen.getByTestId('ppt-failures')).toHaveTextContent('policy denied');
    expect(screen.getByTestId('ppt-diagram')).toBeInTheDocument();
    expect(runDemo).not.toHaveBeenCalled();
  });
});
