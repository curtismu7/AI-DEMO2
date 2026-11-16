import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HostileMcpTab from '../HostileMcpTab';

// The JSON panes keep the visitor's Form | JSON choice in localStorage; start every test from the default (Form).
beforeEach(() => { try { localStorage.clear(); } catch { /* storage unavailable: the default applies */ } });
afterEach(() => vi.unstubAllGlobals());

const pane = (name) => screen.getByRole('group', { name });
// A Form row: its key label and its value text, so an assertion names both.
const rowOf = (root, key) => within(root).getByText(key, { selector: 'dt' }).closest('.jp-row');
// The exact text of that row's value (a substring match would let a changed value through).
const valueOf = (root, key) => rowOf(root, key).querySelector('.jp-d').textContent;

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
    expect(valueOf(pane('Agent request'), 'path')).toBe('/api/privilege-mcp/agent/run');
    expect(valueOf(pane('Agent request'), 'provider')).toBe('llamacpp');
    expect(screen.getAllByText(/Transferred \$500 to external-001/).length).toBeGreaterThan(0);
    expect(valueOf(pane('Agent response'), 'verdict')).toBe('allowed');
    expect(valueOf(pane('tools/list request'), 'path')).toBe('/api/privilege-mcp/tools/list');
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

describe('HostileMcpTab JSON panes', () => {
  const isJson = (text) => { try { const v = JSON.parse(text); return v !== null && typeof v === 'object'; } catch { return false; } };
  const loadAndRun = async () => {
    stubHostileRun({ ok: true, json: async () => ({ trace: [{ step: 1, tool: 'create_transfer', verdict: 'denied', detail: 'policy' }], answer: 'Blocked.' }) });
    await startAgentRun();
    await screen.findByTestId('hostile-agent-outcome');
  };

  it('shows the evidence and the tool schema as panes: Form by default, the exact JSON in the JSON view', async () => {
    await loadAndRun();
    expect(pane('Agent request')).toHaveAttribute('role', 'group');
    expect(pane('create_transfer input schema')).toBeInTheDocument();
    fireEvent.click(within(pane('Agent request').closest('.jp-box')).getByRole('button', { name: 'JSON' }));
    const request = JSON.parse(screen.getByLabelText('Agent request').textContent);
    expect(request).toEqual({ method: 'POST', path: '/api/privilege-mcp/agent/run', body: { provider: 'llamacpp', task: "What's the weather in Denver?" } });
    // the choice is page-wide: the other panes follow
    expect(isJson(screen.getByLabelText('tools/list response').textContent)).toBe(true);
    expect(isJson(screen.getByLabelText('Agent response').textContent)).toBe(true);
  });
  it('keeps the hostile description as text and puts the schema beside it in a pane', async () => {
    await loadAndRun();
    const desc = document.querySelector('.hmc-tool__desc');
    expect(desc.querySelector('pre').textContent).toBe('poisoned metadata');
    expect(within(desc).getByRole('group', { name: 'create_transfer input schema' })).toBeInTheDocument();
  });
  it('leaves no hand-rolled pre holding JSON and no height cap or scroll rule in the stylesheet', async () => {
    await loadAndRun();
    const hand = Array.from(document.querySelectorAll('.hmc pre:not(.jp-raw)'));
    expect(hand.length).toBeGreaterThan(0); // the description text is still a pre
    for (const pre of hand) expect(isJson(pre.textContent), pre.textContent.slice(0, 40)).toBe(false);
    const css = readFileSync(resolve(process.cwd(), 'src/pages/HostileMcpTab.css'), 'utf8');
    expect(css).not.toMatch(/max-height/);
    expect(css).not.toMatch(/overflow\s*:\s*(auto|scroll)/);
  });
});
