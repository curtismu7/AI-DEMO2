import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => localStorage.clear());
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
    await waitFor(() => expect(screen.getByRole('textbox', { name: /message dot/i }).value).toBe(''));
  });

  it('chips send their prompt and disappear after the first message', async () => {
    mockFetch(() => json(200, { reply: 'ok', success: true, toolsCalled: [] }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Call me Sam' }));
    await screen.findByText('ok');
    expect(screen.queryByRole('group', { name: 'Suggested prompts' })).toBeNull();
  });

  it('skin tabs link to the Studio; theme button toggles', () => {
    mockFetch(() => json(200, {}));
    renderPage();
    expect(screen.getByRole('link', { name: 'Claude' }).getAttribute('href')).toContain('/personal-agent?skin=claude');
    fireEvent.click(screen.getByRole('button', { name: /light|dark/i }));
    expect(document.querySelector('[data-cur-theme]').getAttribute('data-cur-theme')).toBe('light');
  });
});
