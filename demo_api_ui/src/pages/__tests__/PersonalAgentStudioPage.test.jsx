import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

// Mock TokenChainContext
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: () => ({ events: [] }),
}));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
// The app's ACTIVE vertical, set from the test. null = nothing resolved (guest / no provider): the page falls back to airlines.
const verticalState = { activeId: null, pageManifest: null };
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => verticalState }));
vi.mock('../../components/VerticalSwitcher', () => ({ default: () => <div data-testid="vertical-switcher" /> }));

vi.mock('../OboDemoPage', () => ({ default: () => <div data-testid="obo-page" /> }));
vi.mock('../../components/SignInPrompt', () => ({ default: ({ message }) => <div data-testid="signin">{message}</div> }));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';
import css from '../PersonalAgentStudioPage.css?raw';
import apiClient from '../../services/apiClient';

// The run now carries a random flowTraceId (so the BFF can stream this run's authorize decision and tool result).
const withFlowTrace = (body) => {
  const head = JSON.stringify(body).slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect.stringMatching(new RegExp(`^${head},"flowTraceId":"[^"]+"}$`));
};


const renderStudio = (url = '/') => render(
  <MemoryRouter initialEntries={[url]}>
    <PersonalAgentStudioPage />
  </MemoryRouter>,
);

describe('PersonalAgentStudioPage', () => {
  it('renders page title', () => {
    renderStudio();
    expect(screen.getByText('Digital Assistant')).toBeTruthy();
  });

  it('renders all skin tabs', () => {
    renderStudio();
    expect(screen.getByText('Privilege')).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
    expect(screen.getByText('Terminal')).toBeTruthy();
    expect(screen.getAllByText('ChatGPT').length).toBeGreaterThan(0); // the diagram below also names ChatGPT as a participant
    expect(screen.getByText('Gemini')).toBeTruthy();
  });

  it('shows Split and Pop Out buttons', () => {
    renderStudio();
    expect(screen.getByText(/Split/i)).toBeTruthy();
    expect(screen.getByText(/🪟 Pop Out/i)).toBeTruthy();
  });

  it('starts in full-agent mode — security rail hidden', () => {
    renderStudio();
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('shows security rail after clicking Split', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
  });

  it('hides security rail when Split clicked again', () => {
    renderStudio();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    fireEvent.click(screen.getByText(/Split/i));
    expect(screen.queryByText('Security Gates')).toBeNull();
  });

  it('switches active skin tab', () => {
    renderStudio();
    fireEvent.click(screen.getByText('Claude'));
    // AgentClientSkin renders Claude title
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0);
  });

  it('shows popped-out placeholder and security rail after Pop Out', () => {
    // Mock window.open
    vi.stubGlobal('open', vi.fn(() => ({ document: { write: vi.fn(), close: vi.fn() } })));
    renderStudio();
    fireEvent.click(screen.getByText(/🪟 Pop Out/i));
    expect(screen.getByText('Security Gates')).toBeTruthy();
    expect(screen.getByText(/active in external window/i)).toBeTruthy();
  });

  it('launches only the supplied catalog action for a workload run', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Read complete.' }) }));
    render(<MemoryRouter><PersonalAgentStudioPage scenario={{ id: 'UC44', useCaseId: 'workload-digital-assistant-obo', primaryTool: 'list_gear', runPrompt: 'my gear' }} vertical="sporting-goods" runNonce={1} /></MemoryRouter>);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: withFlowTrace({ prompt: 'my gear', vertical: 'sporting-goods', useCaseId: 'workload-digital-assistant-obo', agentMode: 'heuristics' }),
    })));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(await screen.findByText('Read complete.')).toBeTruthy();
  });

  it('loads a direct workload query with scenario-specific opening context', async () => {
    apiClient.get.mockResolvedValue({ data: { useCase: {
      id: 'UC38', title: 'Workload Agent: MFA-gated protected action', useCaseId: 'personal-agent-concierge',
      primaryTool: 'extend_rental', runPrompt: 'extend my rental $600',
    } } });
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC38&vertical=sporting-goods']}><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByText(/Customer MFA is checked before this protected write/i)).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC38?vertical=sporting-goods');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('keeps legacy freeform prompts on the generic Airlines agent route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ reply: 'Miles checked.' }) }));
    renderStudio();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'check my miles' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: JSON.stringify({ prompt: 'check my miles', vertical: 'airlines', agentMode: 'heuristics' }),
    })));
    expect(await screen.findByText('Miles checked.')).toBeTruthy();
  });

  it('hides a stale catalog action while a changed query is loading', async () => {
    let resolveSecond;
    apiClient.get.mockImplementation((url) => url.includes('UC38')
      ? Promise.resolve({ data: { useCase: { id: 'UC38', title: 'Protected action', useCaseId: 'personal-agent-concierge', primaryTool: 'extend_rental', runPrompt: 'extend my rental $600' } } })
      : new Promise((resolve) => { resolveSecond = resolve; }));
    function ChangeQuery() {
      const navigate = useNavigate();
      return <button onClick={() => navigate('/personal-agent?useCase=UC44&vertical=banking')}>Change query</button>;
    }
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC38&vertical=sporting-goods']}><ChangeQuery /><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Run rental extension' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change query' }));
    expect(apiClient.get).toHaveBeenCalledWith('/api/use-cases/UC44?vertical=banking');
    expect(screen.queryByRole('button', { name: 'Run rental extension' })).toBeNull();
    expect(screen.queryByText('extend my rental $600')).toBeNull();
    resolveSecond({ data: { useCase: { id: 'UC44', title: 'Customer read', useCaseId: 'workload-digital-assistant-obo', primaryTool: 'get_account_balance', runPrompt: 'show my balance' } } });
    expect(await screen.findByRole('button', { name: 'Run UC44 action' })).toBeTruthy();
    expect(screen.getByText(/get_account_balance/)).toBeTruthy();
  });

  it('shows a failed direct-query catalog load and retries the selected action', async () => {
    apiClient.get.mockReset();
    apiClient.get.mockRejectedValueOnce(new Error('Catalog unavailable')).mockResolvedValueOnce({ data: { useCase: {
      id: 'UC44', title: 'Customer read', useCaseId: 'workload-digital-assistant-obo',
      primaryTool: 'get_account_balance', runPrompt: 'show my balance',
    } } });
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC44&vertical=banking']}><PersonalAgentStudioPage /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent('The catalog action could not be loaded.');
    expect(screen.queryByText(/Loading UC44 action/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Retry loading UC44/i }));
    expect(await screen.findByRole('button', { name: 'Run UC44 action' })).toBeTruthy();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('the Dot tab is labelled Persona Agent (Dot) and shows the persona strip and memory panel', () => {
    renderStudio();
    expect(screen.queryByTestId('dot-persona-strip')).toBeNull();
    fireEvent.click(screen.getByText('Persona Agent (Dot)'));
    expect(screen.getByTestId('dot-persona-strip')).toBeTruthy();
    expect(screen.getByText(/your always-on persona agent/)).toBeTruthy();
    expect(screen.getByTestId('dot-memory-panel')).toBeTruthy();
  });

  it('offers example prompts on the chat, and a click sends one', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ reply: 'Gold.' }) }));
    vi.stubGlobal('fetch', fetchMock);
    renderStudio();
    expect(screen.getByRole('group', { name: /suggested prompts/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'What is my loyalty status?' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/agent/invoke', expect.objectContaining({
      body: expect.stringContaining('What is my loyalty status?'),
    })));
  });

  it('the OBO tab swaps the chat for the delegation inspector when signed in', () => {
    render(<MemoryRouter><PersonalAgentStudioPage user={{ id: 'u1' }} /></MemoryRouter>);
    expect(screen.queryByTestId('obo-page')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Delegation proof/ }));
    expect(screen.getByTestId('obo-page')).toBeTruthy();
    expect(screen.queryByText('Privilege')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Agent' }));
    expect(screen.getByText('Privilege')).toBeTruthy();
  });

  it('?tab=obo deep-links to the OBO tab, and signed-out users get a sign-in prompt', () => {
    render(<MemoryRouter initialEntries={['/personal-agent?tab=obo']}><PersonalAgentStudioPage /></MemoryRouter>);
    expect(screen.getByTestId('signin')).toBeTruthy();
    expect(screen.queryByTestId('obo-page')).toBeNull();
  });

  it('puts the client setup cards below the agent, not above it', () => {
    renderStudio();
    const agent = screen.getByPlaceholderText(/^Message /);
    const cards = screen.getByText('Personal agent clients');
    // DOCUMENT_POSITION_FOLLOWING (4): the cards come after the chat input
    expect(agent.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is a fixed-height shell: the reel is stacked under the chat inside it, the client cards sit outside (page scrolls to them)', () => {
    const { container } = renderStudio();
    const shell = screen.getByTestId('studio-shell');
    const host = container.querySelector('.tcfs-float-host');
    expect(host.classList.contains('tcfs-float-host--stacked')).toBe(true);
    expect(shell.contains(host)).toBe(true);
    // inside the shell the cards took ~500px of the column and got clipped, squeezing the reel
    expect(shell.contains(screen.getByText('Personal agent clients'))).toBe(false);
    // a percentage max-height can't resolve here; the cap lives in the class (50% of the shell)
    expect(host.style.maxHeight).toBe('');
  });

  it('bare variant drops the chrome-height subtraction from the shell', () => {
    // The height rules live in the stylesheet (so the stacked layout can flow at natural height); the shell
    // carries a --bare class only when there is no app chrome, and the CSS subtracts the chrome height only without it.
    const { rerender } = renderStudio();
    expect(screen.getByTestId('studio-shell').classList.contains('pas-shell--bare')).toBe(false);
    rerender(<MemoryRouter><PersonalAgentStudioPage bare /></MemoryRouter>);
    expect(screen.getByTestId('studio-shell').classList.contains('pas-shell--bare')).toBe(true);
    const rule = (selector) => css.match(new RegExp(selector.replace(/[.]/g, '\\.') + '\\s*\\{[^}]*\\}'))?.[0] || '';
    expect(rule('.pas-shell')).toContain('176px');
    expect(rule('.pas-shell--bare')).not.toContain('176px');
  });

  it('the flow diagram disclosure says "Expand for Diagram"', () => {
    renderStudio();
    const summary = screen.getByText('Expand for Diagram');
    expect(summary.tagName).toBe('SUMMARY');
    expect(screen.queryByText('How a request flows')).toBeNull();
  });

  it('cockpit flows at its natural height: sticky chat, pinned dock, no fixed-height squeeze of the right column', () => {
    // A fixed-height grid gave the right column ~200px on a laptop, clipping the reel and token detail.
    const body = (selector) => { const i = css.indexOf(selector + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
    const grid = css.split('.pas-shell--cockpit {').map((chunk) => chunk.slice(0, chunk.indexOf('}'))).find((chunk) => chunk.includes('grid-template-rows'));
    expect(body('.pas-shell--cockpit > .pas-c-chat')).toContain('position: sticky');
    expect(body('.pas-shell--cockpit > .personal-agent-client-dock')).toContain('position: sticky');
    expect(grid).toContain('height: auto');
    expect(grid).not.toContain('minmax(0, 1fr);');
  });

  describe('vertical picker', () => {
    const sentBody = async (url = '/') => {
      const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) }));
      vi.stubGlobal('fetch', fetchMock);
      renderStudio(url);
      const input = screen.getAllByPlaceholderText(/^Message /)[0];
      fireEvent.change(input, { target: { value: 'hello there' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/agent/invoke'));
      return JSON.parse(call[1].body);
    };
    beforeEach(() => { verticalState.activeId = null; verticalState.pageManifest = null; });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('shows the vertical picker in the header', () => {
      renderStudio();
      expect(screen.getByTestId('vertical-switcher')).toBeTruthy();
      expect(screen.getByText('Vertical')).toBeTruthy();
    });

    it('with no vertical resolved the chat still talks to the airline demo', async () => {
      expect((await sentBody()).vertical).toBe('airlines');
    });

    it("the chat follows the app's active vertical", async () => {
      verticalState.activeId = 'retail';
      expect((await sentBody()).vertical).toBe('retail');
    });

    it('an explicit ?vertical= beats the active vertical', async () => {
      verticalState.activeId = 'retail';
      expect((await sentBody('/personal-agent?vertical=banking')).vertical).toBe('banking');
    });

    it('the opening line and prompts follow the vertical (no MileagePlus outside airlines)', () => {
      verticalState.activeId = 'retail';
      renderStudio();
      expect(screen.queryByText(/MileagePlus/)).toBeNull();
      expect(screen.getByText(/I'm your digital assistant\. What would you like to do today\?/)).toBeTruthy();
      expect(screen.queryByText('What is my loyalty status?')).toBeNull();
    });

    it('airlines keeps its opening line and tuned prompts', () => {
      verticalState.activeId = 'airlines';
      renderStudio();
      expect(screen.getByText(/MileagePlus/)).toBeTruthy();
      expect(screen.getAllByText('What is my loyalty status?').length).toBeGreaterThan(0);
    });
  });

  describe('layout switch (Stacked | Cockpit)', () => {
    beforeEach(() => { window.localStorage.removeItem('pas-layout'); });
    const shell = () => screen.getByTestId('studio-shell');

    it('stacked carries the numbered-section hooks; cockpit does not', () => {
      const { unmount } = renderStudio();
      expect(shell().classList.contains('pas-shell--stacked')).toBe(true);
      expect(document.querySelector('.pas-c-cards')).not.toBeNull();
      unmount();
      renderStudio('/personal-agent?layout=cockpit');
      expect(shell().classList.contains('pas-shell--stacked')).toBe(false);
      expect(document.querySelector('.pas-c-cards')).toBeNull();
    });

    it('with no token events the Token Chain panel keeps its intro (no empty token cards)', () => {
      renderStudio();
      expect(screen.getByText('What this panel shows')).toBeTruthy();
      expect(document.querySelector('.token-cards')).toBeNull();
    });

    it('defaults to the stacked layout: full client cards, no gate chips, no dock', () => {
      renderStudio();
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(false);
      expect(screen.getByText('Personal agent clients')).toBeTruthy();
      expect(screen.queryByText('Connect a client')).toBeNull();
      expect(screen.queryByLabelText('Security gates')).toBeNull();
      expect(screen.getByRole('button', { name: 'Stacked' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('?layout=cockpit opens the cockpit: three gate chips and the client dock instead of the cards', () => {
      renderStudio('/personal-agent?layout=cockpit');
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(true);
      expect(within(screen.getByLabelText('Security gates')).getAllByRole('listitem')).toHaveLength(3);
      expect(screen.getByText('Connect a client')).toBeTruthy();
      expect(screen.queryByText('Personal agent clients')).toBeNull();
      expect(screen.getByRole('button', { name: 'Cockpit' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('the toggle switches layouts and remembers the choice', () => {
      renderStudio();
      fireEvent.click(screen.getByRole('button', { name: 'Cockpit' }));
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(true);
      expect(window.localStorage.getItem('pas-layout')).toBe('cockpit');
      fireEvent.click(screen.getByRole('button', { name: 'Stacked' }));
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(false);
      expect(window.localStorage.getItem('pas-layout')).toBe('stacked');
    });

    it('a remembered cockpit choice is used when the URL does not say', () => {
      window.localStorage.setItem('pas-layout', 'cockpit');
      renderStudio();
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(true);
    });

    it('an explicit ?layout=stacked beats a remembered cockpit', () => {
      window.localStorage.setItem('pas-layout', 'cockpit');
      renderStudio('/personal-agent?layout=stacked');
      expect(shell().classList.contains('pas-shell--cockpit')).toBe(false);
    });

    it('switching layouts keeps what you typed (same chat element, no remount)', () => {
      renderStudio();
      const input = screen.getAllByPlaceholderText(/^Message /)[0];
      fireEvent.change(input, { target: { value: 'What is my loyalty status?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cockpit' }));
      expect(screen.getAllByPlaceholderText(/^Message /)[0].value).toBe('What is my loyalty status?');
    });
  });
});
