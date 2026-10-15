import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockDark = true;
let mockVertical = { activeId: 'healthcare', pageManifest: { dashboard: { chips10: [
  { id: 'h1', label: 'My claims', message: 'Show my open claims' },
  { id: 'h2', label: 'Find a doctor', message: 'Find an in-network cardiologist' },
] } } };
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => mockVertical }));
const mockToggle = vi.fn();
vi.mock('../../context/ThemeContext', () => ({ useThemeOptional: () => ({ darkMode: mockDark, toggleDarkMode: mockToggle }) }));
vi.mock('../../utils/signInService', () => ({ openSignIn: vi.fn() }));
vi.mock('../../components/DotMemoryPanel', () => ({ default: ({ refreshNonce }) => <div data-testid="memory" data-nonce={refreshNonce}>memory</div> }));
import { openSignIn } from '../../utils/signInService';
import DotWorkbenchPage from '../DotWorkbenchPage';

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
function mockFetch(invoke) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/agent-builder/state')) {
      return json(200, { agent: { id: 'ag-9', name: 'Dot' }, resources: [{ granted: ['miles:read'] }] });
    }
    return invoke();
  });
}
const renderPage = () => render(<MemoryRouter><DotWorkbenchPage user={{ email: 'sam@x.com' }} /></MemoryRouter>);
const send = (text) => {
  fireEvent.change(screen.getByRole('textbox', { name: /message dot/i }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

beforeEach(() => { localStorage.clear(); mockDark = true; });
afterEach(cleanup);

describe('DotWorkbenchPage', () => {
  it('renders persona (real values), chat, memory and governs panels', async () => {
    mockFetch(() => json(200, {}));
    renderPage();
    expect(await screen.findByText('ag-9')).toBeTruthy();
    expect(screen.getByText('sam@x.com')).toBeTruthy();
    expect(screen.getByTestId('memory')).toBeTruthy();
    expect(screen.getByLabelText('What Ping governs')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Suggested prompts' })).toBeTruthy();
  });

  it('a permitted tool call renders a PERMIT card and Dot reply; memories bump the memory panel', async () => {
    mockFetch(() => json(200, { reply: 'Got it.', success: true, toolsCalled: ['book_flight'], dotMemories: ['aisle seats'] }));
    renderPage();
    send('Always book me an aisle seat');
    expect(await screen.findByText('PERMIT')).toBeTruthy();
    expect(screen.getByText('Got it.')).toBeTruthy();
    expect(screen.getByText(/remembered: aisle seats/)).toBeTruthy();
    expect(screen.getByTestId('memory').dataset.nonce).toBe('1');
  });

  it('a gateway deny (200 + success:false) renders DENY, not PERMIT', async () => {
    mockFetch(() => json(200, { reply: '❌ access_denied', success: false, toolsCalled: ['transfer_miles'] }));
    renderPage();
    send('Transfer 20000 miles');
    expect(await screen.findByText('DENY')).toBeTruthy();
    expect(screen.queryByText('PERMIT')).toBeNull();
  });

  it('200 + need_auth guest reply shows the sign-in panel, not a Dot bubble', async () => {
    mockFetch(() => json(200, { success: false, need_auth: true, requiresLogin: true, toolsCalled: [], reply: 'Please sign in to use the banking agent' }));
    renderPage();
    send('hello');
    expect(await screen.findByRole('button', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByText(/Please sign in to use the banking agent/)).toBeNull();
  });

  it('401 shows the sign-in panel and no card; its button opens sign-in', async () => {
    mockFetch(() => json(401, { error: 'authentication_required' }));
    renderPage();
    send('hello');
    const btn = await screen.findByRole('button', { name: /sign in/i });
    expect(screen.queryByText('PERMIT')).toBeNull();
    fireEvent.click(btn);
    expect(openSignIn).toHaveBeenCalled();
  });

  it('a network failure shows an error bubble and re-enables Send', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('agent-builder')) return json(401, {});
      throw new Error('net');
    });
    renderPage();
    send('hi');
    expect(await screen.findByText('Dot could not complete that request.')).toBeTruthy();
    const invokes = () => global.fetch.mock.calls.filter(([u]) => String(u).includes('/api/agent/invoke')).length;
    expect(invokes()).toBe(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(true)); // empty input
    send('again');
    await waitFor(() => expect(invokes()).toBe(2));
  });

  it('chips send their prompt and disappear after the first message', async () => {
    mockFetch(() => json(200, { reply: 'ok', success: true, toolsCalled: [] }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'My claims' }));
    await screen.findByText('ok');
    expect(screen.queryByRole('group', { name: 'Suggested prompts' })).toBeNull();
  });

  it('the page theme IS the app theme: it follows a flip from the main top bar', () => {
    mockFetch(() => json(200, {}));
    const ui = () => <MemoryRouter><DotWorkbenchPage user={{ email: 'sam@x.com' }} /></MemoryRouter>;
    const { rerender } = render(ui());
    expect(document.querySelector('[data-cur-theme]').getAttribute('data-cur-theme')).toBe('dark');
    mockDark = false;
    rerender(ui());
    expect(document.querySelector('[data-cur-theme]').getAttribute('data-cur-theme')).toBe('light');
    mockDark = true;
  });

  it("chips come from the active vertical (label shown, its prompt sent), and the invoke uses that vertical", async () => {
    mockFetch(() => json(200, { reply: 'ok', success: true, toolsCalled: [] }));
    renderPage();
    expect(screen.queryByRole('button', { name: 'Always book me an aisle seat' })).toBeNull();
    expect(screen.getByRole('button', { name: 'What do you remember about me?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'My claims' }));
    await screen.findByText('ok');
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/agent/invoke'));
    expect(JSON.parse(call[1].body)).toMatchObject({ prompt: 'Show my open claims', vertical: 'healthcare' });
  });

  it('no active vertical yet: sends no vertical (server default) and offers only the neutral Dot chips', async () => {
    mockVertical = { activeId: null, pageManifest: null };
    mockFetch(() => json(200, { reply: 'ok', success: true, toolsCalled: [] }));
    renderPage();
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('dot-chip')).map((b) => b.textContent)).toEqual(['Always keep your answers short', 'Call me Sam', 'What do you remember about me?']);
    fireEvent.click(screen.getByRole('button', { name: 'What do you remember about me?' }));
    await screen.findByText('ok');
    const call = global.fetch.mock.calls.find(([u]) => String(u).includes('/api/agent/invoke'));
    expect(JSON.parse(call[1].body).vertical).toBeUndefined();
  });

  it('skin tabs link to the Studio', () => {
    mockFetch(() => json(200, {}));
    renderPage();
    expect(screen.getByRole('link', { name: 'Claude' }).getAttribute('href')).toContain('/personal-agent?skin=claude');
  });

  it('the theme button flips the APP theme (no page-local theme, nothing written to storage)', () => {
    mockFetch(() => json(200, {}));
    mockToggle.mockClear();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /light|dark/i }));
    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('cur_priv_theme')).toBeNull();
    // the page does not decide the theme itself: it only reflects the app's
    expect(document.querySelector('[data-cur-theme]').getAttribute('data-cur-theme')).toBe('dark');
  });
});
