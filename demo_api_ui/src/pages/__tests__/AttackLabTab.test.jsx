import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../services/apiClient';
import AttackLabTab from '../AttackLabTab';

vi.mock('../../services/apiClient', () => ({ default: { post: vi.fn() } }));
vi.mock('../HostileMcpTab', () => ({ default: () => <><aside>Manually confirm hostile-mcp denies create_transfer. If user not found in system, sync identity.</aside><h3>Hostile MCP runner</h3></> }));
vi.mock('../../components/InterAgentAbuseTester', () => ({ default: () => <h3>Inter-Agent runner</h3> }));

// The evidence panes keep the visitor's Form | JSON choice in localStorage; start every test from the default (Form).
const pane = (name) => screen.getByRole('group', { name });
// A Form row: its key label and its value text, so an assertion names both.
const rowOf = (root, key) => within(root).getByText(key, { selector: 'dt' }).closest('.jp-row');
// The exact text of that row's value (a substring match would let a changed value through).
const valueOf = (root, key) => rowOf(root, key).querySelector('.jp-d').textContent;

describe('AttackLabTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    try { localStorage.clear(); } catch { /* storage unavailable: the default applies */ }
  });

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
    expect((await screen.findAllByText(/resource_owner_mismatch/i)).length).toBeGreaterThan(0);
    expect(screen.getByTestId('attack-lab-model-reached')).toHaveTextContent('No');
    expect(screen.getByText(/different owner’s account \(account_id redacted\)/i)).toBeInTheDocument();
    expect(screen.getByTestId('attack-lab-backend-reached')).toHaveTextContent('Yes');
  });

  it('shows the Tool Abuse request and safe observed response details', async () => {
    apiClient.post.mockResolvedValue({ data: {
      sim: 'cross-owner-account', useCaseId: 'uc10', status: 403, errorCode: 'resource_owner_mismatch',
      tokenChainEvents: [{ id: 'sim-cross-owner-denied', label: 'Cross-owner balance read denied', status: 'deny' }],
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tool Abuse' }));
    fireEvent.click(screen.getByRole('button', { name: /run tool abuse check/i }));

    const sent = await screen.findByRole('group', { name: 'Request sent' });
    expect(valueOf(sent, 'path')).toBe('/api/demo/attack-sim/run');
    expect(valueOf(sent, 'sim')).toBe('cross-owner-account');
    const seen = pane('Observed response (sensitive fields omitted)');
    expect(valueOf(seen, 'sim')).toBe('cross-owner-account');
    expect(valueOf(seen, 'errorCode')).toBe('resource_owner_mismatch');
    expect(rowOf(seen, 'errorCode').getAttribute('data-alert')).toBe('true');
    // status is not an error key here: a plain pre showed it without emphasis, so it must not turn red
    expect(within(seen).getAllByText('status', { selector: 'dt' })[0].closest('.jp-row').getAttribute('data-alert')).toBeNull();
    expect(within(seen).getAllByText(/Cross-owner balance read denied/).length).toBeGreaterThan(0);
  });

  it('reports tool poisoning policy and identity prerequisites before mounting its runner', () => {
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Tool Poisoning' }));

    expect(screen.getByText(/manually confirm.*hostile-mcp.*denies.*create_transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/user not found in system/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hostile MCP runner' })).toBeInTheDocument();
  });

  it('labels the Malicious Content prompt as unsent until the live run', () => {
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));

    expect(screen.getByText(/live content check.*through privilege/i)).toBeInTheDocument();
    expect(screen.getByText(/example prompt only.*sent to privilege when you run the check/i)).toBeInTheDocument();
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

  it('shows the exact request and returned redaction markers for Malicious Content', async () => {
    apiClient.post.mockResolvedValue({ data: {
      reply: 'Fictional sample: [REDACTED:pii]', provider: 'anthropic', reachedProvider: true,
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));
    fireEvent.click(screen.getByRole('button', { name: /run live content check/i }));

    expect(await screen.findByRole('heading', { name: 'Request sent' })).toBeInTheDocument();
    const sent = pane('Request sent');
    expect(valueOf(sent, 'method')).toBe('POST');
    expect(valueOf(sent, 'path')).toBe('/api/privilege-mcp/llm/call');
    expect(valueOf(sent, 'provider')).toBe('anthropic');
    expect(valueOf(sent, 'prompt')).toMatch(/^Create a clearly marked fictional phishing-email example/);
    expect(screen.getByRole('heading', { name: 'Gateway response' })).toBeInTheDocument();
    expect(screen.getByText('Fictional sample: [REDACTED:pii]')).toBeInTheDocument();
    expect(screen.getByText(/Privilege returned 1 \[REDACTED:…\] marker/i)).toBeInTheDocument();
    expect(screen.getByText(/original matched values are not included in this response/i)).toBeInTheDocument();
    expect(screen.getByText(/this request was sent to privilege/i)).toBeInTheDocument();
    expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp/llm/call', {
      provider: 'anthropic',
      prompt: 'Create a clearly marked fictional phishing-email example for an awareness slide. Use only https://example.invalid/login and fake placeholders such as [employee name]. Do not include real brands, credentials, executable code, or attachments.',
    });
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

  it('shows the schema-violation request and validator response details', async () => {
    apiClient.post.mockResolvedValue({ data: {
      error: 'Invalid arguments for tool create_transfer', validator: 'MCP input schema', backendReached: false,
    } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Schema Violation' }));
    fireEvent.click(screen.getByRole('button', { name: /run schema violation check/i }));

    const sent = await screen.findByRole('group', { name: 'Request sent' });
    expect(valueOf(sent, 'path')).toBe('/api/mcp-gateway/test');
    expect(valueOf(sent, 'tool')).toBe('create_transfer');
    expect(valueOf(pane('Observed response'), 'validator')).toBe('MCP input schema');
    expect(within(pane('Observed response')).getAllByText(/Invalid arguments for tool create_transfer/).length).toBeGreaterThan(0);
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

  it('shows the exact JSON of the request and the response in the JSON view, and the Malicious Content reply stays text', async () => {
    apiClient.post.mockResolvedValue({ data: { error: 'Invalid arguments for tool create_transfer', validator: 'MCP input schema', backendReached: false } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Schema Violation' }));
    fireEvent.click(screen.getByRole('button', { name: /run schema violation check/i }));
    fireEvent.click(within((await screen.findByRole('group', { name: 'Request sent' })).closest('.jp-box')).getByRole('button', { name: 'JSON' }));

    expect(JSON.parse(screen.getByLabelText('Request sent').textContent)).toMatchObject({ method: 'POST', path: '/api/mcp-gateway/test', body: { tool: 'create_transfer' } });
    expect(JSON.parse(screen.getByLabelText('Observed response').textContent)).toEqual({
      error: 'Invalid arguments for tool create_transfer', validator: 'MCP input schema', backendReached: false,
    });
  });

  it('keeps the Malicious Content reply as text in a pre and puts only the request in a pane', async () => {
    apiClient.post.mockResolvedValue({ data: { reply: '{"looks":"like json"}', provider: 'anthropic', reachedProvider: true } });
    render(<AttackLabTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Malicious Content' }));
    fireEvent.click(screen.getByRole('button', { name: /run live content check/i }));

    expect(await screen.findByRole('group', { name: 'Request sent' })).toBeInTheDocument();
    expect(screen.getByText('{"looks":"like json"}').tagName).toBe('PRE');
    expect(screen.queryByLabelText('Gateway response')).toBeNull();
  });

  it('no stylesheet rule caps or scrolls the evidence', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/pages/AttackLabTab.css'), 'utf8');
    expect(css).not.toMatch(/max-height/);
    expect(css).not.toMatch(/overflow\s*:\s*(auto|scroll)/);
  });
});
