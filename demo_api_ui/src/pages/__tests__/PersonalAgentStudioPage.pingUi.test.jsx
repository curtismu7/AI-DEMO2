// /personal-agent on the Ping UI Standard: P2 banner first, P7 chips with words, P9 one primary per view state,
// H3 no inline themeable style, and a busy Run that keeps keyboard focus (aria-disabled, never disabled).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../context/TokenChainContext', () => ({ useTokenChainOptional: () => ({ events: [] }) }));
vi.mock('../../services/apiClient', () => ({ default: { get: vi.fn() } }));
vi.mock('../../vertical/useVertical', () => ({ useVertical: () => ({ activeId: null, pageManifest: null }) }));
vi.mock('../../components/VerticalSwitcher', () => ({ default: () => <div data-testid="vertical-switcher" /> }));
vi.mock('../OboDemoPage', () => ({ default: () => <div data-testid="obo-page" /> }));
vi.mock('../../components/SignInPrompt', () => ({ default: ({ message }) => <div data-testid="signin">{message}</div> }));

import PersonalAgentStudioPage from '../PersonalAgentStudioPage';
import apiClient from '../../services/apiClient';

afterEach(() => vi.unstubAllGlobals());

const scenario = { id: 'UC44', title: 'Customer read', useCaseId: 'workload-digital-assistant-obo', primaryTool: 'get_account_balance', runPrompt: 'show my balance' };
const primaries = (root = document) => [...root.querySelectorAll('button.pu-btn--primary')];
const renderStudio = (props = {}) => render(<MemoryRouter><PersonalAgentStudioPage {...props} /></MemoryRouter>);

describe('PersonalAgentStudioPage Ping UI Standard', () => {
  it('P2: the banner is the first thing in the page, a note that names what is simulated and what is real', () => {
    const { container } = renderStudio();
    const page = container.querySelector('.pu-page');
    expect(page.firstElementChild.classList.contains('pu-banner-wrap')).toBe(true);
    const banner = screen.getByTestId('studio-banner');
    expect(banner.getAttribute('role')).toBe('note');
    expect(banner.textContent).toMatch(/look-alikes/);
    expect(banner.textContent).toMatch(/signed-in session/);
    expect(page.querySelector('h1').textContent).toBe('Digital Assistant');
  });

  it('P2: the banner stays short (the reel must stay above the fold) and says what is simulated and what is real', () => {
    renderStudio();
    const text = screen.getByTestId('studio-banner').textContent;
    expect(text.length).toBeLessThan(300);
    expect(text).toMatch(/SIMULATED CLIENTS, REAL GOVERNANCE/);
    expect(text).toMatch(/gates and tokens are real/i);
    expect(text).toMatch(/Replay is an animation/);
  });

  it('H3: the header band carries no inline style', () => {
    const { container } = renderStudio();
    // The studio's own markup. The client skins and the diagram inside it are separate components with their own styles.
    expect(container.querySelectorAll('.pas-c-header [style], .pas-c-header[style], .pas-agent[style], .pas-skin[style], .pas-skin__body[style], .pas-c-flow > [style], .pas-c-flow > summary[style], .pas-c-reel[style], .pas-c-chat[style]').length).toBe(0);
    expect(container.querySelector('[data-testid="studio-shell"] style')).toBeNull();
  });

  it('P9: tabs, client pills and layout controls are secondaries, and the pills say which is on', () => {
    renderStudio();
    expect(screen.getByRole('tab', { name: 'Agent' }).classList.contains('pu-btn')).toBe(true);
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('true');
    const pill = (name) => [...document.querySelectorAll('.pas-skins button')].find((b) => b.textContent === name);
    expect(pill('Privilege').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pill('Claude'));
    expect(pill('Claude').getAttribute('aria-pressed')).toBe('true');
    expect(pill('Privilege').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Split' }));
    expect(screen.getByRole('button', { name: 'Split' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('P9 per state: chat skins have no page primary; the Computer Use skin has Run scripted session as the one', () => {
    renderStudio();
    expect(primaries()).toHaveLength(0);
    fireEvent.click(screen.getByText('Computer Use'));
    const lead = primaries();
    expect(lead).toHaveLength(1);
    expect(lead[0].textContent).toBe('Run scripted session');
  });

  it('P7: the pop-out stub carries a chip with a word, and Pop Out says it is on (aria-pressed, not colour alone)', () => {
    vi.stubGlobal('open', vi.fn());
    const { container } = renderStudio();
    const popOut = screen.getByRole('button', { name: /Pop Out/ });
    expect(popOut.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(popOut);
    expect(popOut.getAttribute('aria-pressed')).toBe('true');
    const chip = container.querySelector('.pas-popped .pu-chip');
    expect(chip.textContent).toBe('Listening for token events');
  });

  it('P9 per state (embedded run): Run is the one primary; in step-up the Verify button takes over', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ step_up_required: true, reply: 'Complete MFA.' }) }));
    renderStudio({ scenario, vertical: 'banking' });
    expect(primaries().map((b) => b.textContent)).toEqual(['Run UC44 action']);
    expect(document.querySelector('.pu-status-line .pu-chip').textContent).toBe('Ready');
    fireEvent.click(screen.getByRole('button', { name: 'Run UC44 action' }));
    await screen.findByText('MFA required');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByText('MFA required')).toBeNull());
    expect(primaries().map((b) => b.textContent)).toEqual(['Verify with MFA and run again']);
    expect(document.querySelector('.pu-status-line .pu-chip').textContent).toBe('MFA needed');
  });

  it('P5: the embedded action and prompt are a key-value list', () => {
    const { container } = renderStudio({ scenario, vertical: 'banking' });
    const kv = container.querySelector('dl.pu-kv');
    expect(kv.textContent).toContain('get_account_balance');
    expect(kv.textContent).toContain('show my balance');
  });

  it('a running Run keeps focus: aria-disabled, never disabled, and a second click does not start a second run', async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    renderStudio({ scenario, vertical: 'banking' });
    const run = screen.getByRole('button', { name: 'Run UC44 action' });
    run.focus();
    fireEvent.click(run);
    await screen.findByText('Running the selected action…');
    expect(run.getAttribute('aria-disabled')).toBe('true');
    expect(run.disabled).toBe(false);
    expect(document.activeElement).toBe(run);
    fireEvent.click(run);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/agent/invoke')).toHaveLength(1);
    expect(document.querySelector('.pu-status-line .pu-chip').textContent).toBe('Running');
  });

  it('the scripted Computer Use session keeps focus while it runs, says Running, and a second press does not queue it twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ reply: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    renderStudio();
    fireEvent.click(screen.getByText('Computer Use'));
    const run = screen.getByRole('button', { name: 'Run scripted session' });
    expect(run.getAttribute('aria-disabled')).toBeNull();
    expect(document.querySelector('.pas-cua-bar .pu-chip').textContent).toBe('Ready');
    run.focus();
    fireEvent.click(run);
    fireEvent.click(run);
    await waitFor(() => expect(run.getAttribute('aria-disabled')).toBe('true'));
    expect(run.disabled).toBe(false);
    expect(document.activeElement).toBe(run);
    expect(document.querySelector('.pas-cua-bar .pu-chip').textContent).toBe('Running');
    fireEvent.click(run);
    // All three scripted steps arrive once each, then the button is ready again.
    await waitFor(() => expect(run.getAttribute('aria-disabled')).toBeNull(), { timeout: 4000 });
    const prompts = fetchMock.mock.calls.filter(([url]) => url === '/api/agent/invoke').map(([, init]) => JSON.parse(init.body).prompt);
    expect(prompts).toHaveLength(3);
    expect(new Set(prompts).size).toBe(3);
    expect(document.querySelector('.pas-cua-bar .pu-chip').textContent).toBe('Ready');
  });

  it('P9 per state (catalog load failed): Retry is the one primary', async () => {
    apiClient.get.mockRejectedValueOnce(new Error('down'));
    render(<MemoryRouter initialEntries={['/personal-agent?useCase=UC44&vertical=banking']}><PersonalAgentStudioPage /></MemoryRouter>);
    await screen.findByRole('alert');
    expect(primaries().map((b) => b.textContent)).toEqual(['Retry loading UC44']);
  });
});
