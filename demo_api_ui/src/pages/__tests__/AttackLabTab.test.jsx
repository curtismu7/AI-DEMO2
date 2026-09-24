import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../services/apiClient';
import AttackLabTab from '../AttackLabTab';

vi.mock('../../services/apiClient', () => ({ default: { post: vi.fn() } }));
vi.mock('../HostileMcpTab', () => ({ default: () => <><aside>Manually confirm hostile-mcp denies create_transfer. If user not found in system, sync identity.</aside><h3>Hostile MCP runner</h3></> }));
vi.mock('../../components/InterAgentAbuseTester', () => ({ default: () => <h3>Inter-Agent runner</h3> }));

describe('AttackLabTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('orients presenters to the deck and the observed enforcement point for each scenario', () => {
    render(<AttackLabTab />);

    fireEvent.click(screen.getByText('How to present this lab'));

    expect(screen.getByText(/Slides 1, 5, 6, and 7/i)).toBeInTheDocument();
    expect(screen.getByText(/Tool Abuse: authorization and resource-owner check/i)).toBeInTheDocument();
    expect(screen.getByText(/Tool Poisoning: poisoned metadata leads to a downstream tool-call decision/i)).toBeInTheDocument();
    expect(screen.getByText(/Schema Violation: MCP input schema unless Privilege reports its own decision/i)).toBeInTheDocument();
    expect(screen.getByText(/Inter-Agent Abuse: A2A wire gate/i)).toBeInTheDocument();
    expect(screen.getByText(/Malicious Content: live Privilege LLM Gateway response/i)).toBeInTheDocument();
  });

  it('offers the five requested scenarios without running them on selection', () => {
    render(<AttackLabTab />);

    for (const label of ['Tool Abuse', 'Tool Poisoning', 'Schema Violation', 'Inter-Agent Abuse', 'Malicious Content']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: 'Tool Abuse' }));
    expect(screen.getByText(/non-mutating cross-owner balance read/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('runs the non-mutating Tool Abuse scenario and reports the observed result', async () => {
    apiClient.post.mockResolvedValue({ data: {
      sim: 'cross-owner-account', status: 403, errorCode: 'resource_owner_mismatch',
      tokenChainEvents: [{ id: 'sim-cross-owner-denied', status: 'deny', label: 'Resource owner check' }],
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tool Abuse' }));
    fireEvent.click(screen.getByRole('button', { name: /run tool abuse check/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'cross-owner-account' }));
    expect(await screen.findByText(/resource_owner_mismatch/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-model-reached')).toHaveTextContent('No');
    expect(screen.getByText(/different owner’s account \(account_id redacted\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-backend-reached')).toHaveTextContent('Yes');
  });

  it('reports tool poisoning policy and identity prerequisites before mounting its runner', () => {
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tool Poisoning' }));

    expect(screen.getByText(/manually confirm.*hostile-mcp.*denies.*create_transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/user not found in system/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hostile MCP runner' })).toBeInTheDocument();
  });

  it('requires an explicit live run for Malicious Content and labels fixture data as not inspected', () => {
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));

    expect(screen.getByText(/live content check.*through privilege/i)).toBeInTheDocument();
    expect(screen.getByText(/fixture only.*not sent to privilege/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('reports provider reachability without claiming a policy decision when the provider is reached', async () => {
    apiClient.post.mockResolvedValue({ data: { reply: 'Safe fictional sample.', provider: 'anthropic', reachedProvider: true } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));
    fireEvent.click(screen.getByRole('button', { name: /run live content check/i }));

    expect(await screen.findByText('No gateway decision reported.')).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-model-reached')).toHaveTextContent('Yes');
    expect(screen.queryByText(/Privilege LLM Gateway: denied/i)).not.toBeInTheDocument();
  });

  it('shows an explicit Privilege LLM policy denial and provider reachability', async () => {
    apiClient.post.mockRejectedValue({ response: { status: 403, data: {
      code: 'llm_policy_denied', reason: 'content policy', reachedProvider: false, provider: 'anthropic',
    } } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));
    fireEvent.click(screen.getByRole('button', { name: /run live content check/i }));

    expect(await screen.findByText(/Privilege LLM Gateway: denied — content policy/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-model-reached')).toHaveTextContent('No');
  });

  it('never labels a local schema rejection as blocked by Privilege', async () => {
    apiClient.post.mockResolvedValue({ data: {
      error: 'Invalid arguments for tool create_transfer',
      validator: 'MCP input schema',
      backendReached: false,
      privilegeDecision: null,
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Schema Violation' }));
    fireEvent.click(screen.getByRole('button', { name: /run schema violation check/i }));

    expect(await screen.findByText(/MCP input schema rejected the arguments/i)).toBeInTheDocument();
    expect(screen.queryByText(/blocked by privilege/i)).not.toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/mcp-gateway/test', expect.objectContaining({ tool: 'create_transfer' }));
  });

  it('preserves a top-level Privilege gateway decision from the MCP tester response', async () => {
    apiClient.post.mockResolvedValue({ data: {
      ok: false, decision: 'DENY', error: 'gateway_policy_denied', message: 'Policy denied tool call',
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Schema Violation' }));
    fireEvent.click(screen.getByRole('button', { name: /run schema violation check/i }));

    expect(await screen.findByText(/Privilege MCP Gateway: deny — Policy denied tool call/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-backend-reached')).toHaveTextContent('No');
  });

  it('reports schema request values from the actual catalog payload and leaves PERMIT reachability unknown', async () => {
    apiClient.post.mockResolvedValue({ data: { ok: false, decision: 'PERMIT', message: 'Gateway permitted the request' } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Schema Violation' }));
    fireEvent.click(screen.getByRole('button', { name: /run schema violation check/i }));

    expect(await screen.findByText(/"amount":"one hundred dollars"/i)).toBeInTheDocument();
    expect(screen.getByText(/"override_limits":true/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-backend-reached')).toHaveTextContent('Unknown / not reported');
  });
});
