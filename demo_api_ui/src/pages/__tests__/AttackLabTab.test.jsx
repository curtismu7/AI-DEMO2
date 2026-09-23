import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../services/apiClient';
import AttackLabTab from '../AttackLabTab';

vi.mock('../../services/apiClient', () => ({ default: { post: vi.fn() } }));
vi.mock('../HostileMcpTab', () => ({ default: () => <><aside>Manually confirm hostile-mcp denies create_transfer. If user not found in system, sync identity.</aside><h3>Hostile MCP runner</h3></> }));
vi.mock('../../components/InterAgentAbuseTester', () => ({ default: () => <h3>Inter-Agent runner</h3> }));

describe('AttackLabTab', () => {
  beforeEach(() => vi.clearAllMocks());

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
      tokenChainEvents: [{ id: 'authz-deny', status: 'deny', label: 'Resource owner check' }],
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tool Abuse' }));
    fireEvent.click(screen.getByRole('button', { name: /run tool abuse check/i }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/api/demo/attack-sim/run', { sim: 'cross-owner-account' }));
    expect(await screen.findByText(/resource_owner_mismatch/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-model-reached')).toHaveTextContent('No');
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
});
