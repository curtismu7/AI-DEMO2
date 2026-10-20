import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HostileMcpTab from '../HostileMcpTab';

afterEach(() => vi.unstubAllGlobals());

function stubHostileRun(agentResponse) {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = String(input);
    if (url.endsWith('/state')) {
      return { ok: true, json: async () => ({ config: { mcpUrl: 'https://hostile-mcp.example/mcp', gatewayMode: 'privilege' }, presets: [] }) };
    }
    if (url.endsWith('/auth/start')) return { ok: true, json: async () => ({}) };
    if (url.endsWith('/tools/list')) {
      return { ok: true, json: async () => ({ tools: [{ name: 'create_transfer', description: 'poisoned metadata', inputSchema: { type: 'object' } }] }) };
    }
    if (url.endsWith('/agent/run')) {
      return agentResponse;
    }
    return { ok: true, json: async () => ({}) };
  }));
}

async function startAgentRun() {
  render(<MemoryRouter><HostileMcpTab /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /sign in with privilege/i }));
  fireEvent.click(await screen.findByRole('button', { name: /run agent/i }));
}

describe('HostileMcpTab live-run reporting', () => {
  it('shows inconclusive when the model did not propose create_transfer', async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [], answer: 'The weather is sunny.' }) });
    await startAgentRun();

    expect(await screen.findByTestId('hostile-agent-outcome')).toHaveTextContent(/no create_transfer call was observed.*inconclusive/i);
  });

  it('identifies the unsynced-user response without treating it as a policy result', async () => {
    stubHostileRun({ ok: false, status: 403, json: async () => ({ error: 'policy denied: user not found in system' }) });
    await startAgentRun();

    expect(await screen.findByTestId('hostile-agent-outcome')).toHaveTextContent(/demo user not found in privilege.*sync the demo user/i);
  });

  it('shows an allowed transfer as a no-money stub and not as an enforced denial', async () => {
    stubHostileRun({ ok: true, json: async () => ({
      trace: [{ tool: 'create_transfer', verdict: 'allowed', detail: 'Transferred $500 to external-001' }],
      answer: 'Done.',
    }) });
    await startAgentRun();

    expect(await screen.findByTestId('hostile-agent-outcome')).toHaveTextContent(/privilege allowed create_transfer.*stub ran and moved no money/i);
    expect(screen.getByText(/Model\/provider reached: Yes — llamacpp/i)).toBeInTheDocument();
    expect(screen.getByText(/Tool-call backend: Yes — at least one call was allowed/i)).toBeInTheDocument();
    expect(screen.queryByText(/privilege denied create_transfer/i)).not.toBeInTheDocument();
    expect(screen.getByText(/"path": "\/api\/privilege-mcp\/agent\/run"/)).toBeInTheDocument();
    expect(screen.getByText(/"provider": "llamacpp"/)).toBeInTheDocument();
    expect(screen.getAllByText(/Transferred \$500 to external-001/).length).toBeGreaterThan(0);
    expect(screen.getByText(/"verdict": "allowed"/)).toBeInTheDocument();
    expect(screen.getByText(/"path": "\/api\/privilege-mcp\/tools\/list"/)).toBeInTheDocument();
    expect(screen.getAllByText(/poisoned metadata/).length).toBeGreaterThan(0);
  });

  it('reports provider reachability and no backend call when the model returns without choosing a tool', async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [], answer: 'No call.' }) });
    await startAgentRun();

    expect(await screen.findByText(/Model\/provider reached: Yes — llamacpp/i)).toBeInTheDocument();
    expect(screen.getByText(/MCP tool metadata server reached: Yes/i)).toBeInTheDocument();
    expect(screen.getByText(/Tool-call backend: Not evaluated — no tool invocation appeared in the trace/i)).toBeInTheDocument();
  });

  it('shows the required manual policy check before any run', async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [], answer: 'No call.' }) });
    render(<MemoryRouter><HostileMcpTab /></MemoryRouter>);

    expect(await screen.findByText(/manually confirm.*hostile-mcp.*policy denies create_transfer/i)).toBeInTheDocument();
  });
});

describe('HostileMcpTab sign-in bounce', () => {
  it('asks the BFF to return to /llm-gateway, not the default /privilege-mcp-client', async () => {
    stubHostileRun({ ok: true, json: async () => ({}) });
    render(<MemoryRouter><HostileMcpTab /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /sign in with privilege/i }));
    await screen.findByRole('button', { name: /run agent/i });

    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/auth/start'));
    expect(JSON.parse(call[1].body)).toEqual({ returnTo: '/llm-gateway' });
  });
});

describe('HostileMcpTab model routing toggle', () => {
  const agentRunBody = () => {
    const call = fetch.mock.calls.find(([url]) => String(url).endsWith('/agent/run'));
    return call ? JSON.parse(call[1].body) : null;
  };

  it('keeps the unmediated llama.cpp lane by default (no viaPrivilege in the request)', async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [], answer: 'ok' }) });
    await startAgentRun();
    await screen.findByTestId('hostile-agent-outcome');

    expect(agentRunBody()).toMatchObject({ provider: 'llamacpp' });
    expect(agentRunBody()).not.toHaveProperty('viaPrivilege');
  });

  it('offers llama.cpp through the Privilege custom lane and sends viaPrivilege: true for it', async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [], answer: 'ok', steps: ['llm_path:privilege'] }) });
    render(<MemoryRouter><HostileMcpTab /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /sign in with privilege/i }));
    fireEvent.change(await screen.findByRole('combobox', { name: /model/i }), { target: { value: 'llamacpp-privilege' } });
    fireEvent.click(await screen.findByRole('button', { name: /run agent/i }));
    await screen.findByTestId('hostile-agent-outcome');

    expect(agentRunBody()).toMatchObject({ provider: 'llamacpp', viaPrivilege: true });
  });
});
