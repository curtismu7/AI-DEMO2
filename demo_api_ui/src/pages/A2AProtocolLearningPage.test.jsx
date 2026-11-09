import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import {
  EducationUIProvider,
  useEducationUI,
} from '../context/EducationUIContext';
import A2AProtocolLearningPage from './A2AProtocolLearningPage';
import pageCss from './A2AProtocolLearningPage.css?raw';
import { A2A_SECTION_FOLD_STORAGE_NAME, A2A_SECTION_IDS } from '../utils/a2aSectionFold';

vi.mock('../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('../components/SignInPrompt', () => ({ default: () => <div data-testid="signin-strip" /> }));

const chainDetail = vi.hoisted(() => ({ value: { present: false } }));

vi.mock('../utils/a2aChainDetail', () => ({
  buildA2aChainDetail: () => chainDetail.value,
}));

vi.mock('../data/a2aRecordedRun', () => ({
  A2A_RECORDED_RUN: {
    capturedAt: '2026-09-01',
    vertical: 'sporting-goods',
    agentCard: null,
    message: {},
    tokenEvents: [],
  },
}));

const cardSummary = vi.hoisted(() => ({ value: null }));
const teachingPanes = vi.hoisted(() => ({ value: [] }));

vi.mock('./a2aTeachingPanes', () => ({
  buildA2aTeachingPanes: () => teachingPanes.value,
  summarizeAgentCard: () => cardSummary.value,
  summarizeActChain: () => null,
  LAYER: { IDENTITY: 'identity', WIRE: 'wire' },
  PROVENANCE: {
    RECONSTRUCTED: 'reconstructed',
    DECODED: 'decoded-claims',
    LIVE: 'live-http',
    IN_PROCESS: 'in-process',
  },
}));

function EducationState() {
  const { panel, tab } = useEducationUI();
  return <output aria-label="Education selection">{`${panel || 'none'}:${tab || 'none'}`}</output>;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EducationUIProvider>
        <A2AProtocolLearningPage />
        <EducationState />
      </EducationUIProvider>
    </MemoryRouter>,
  );
}

describe('A2A protocol learning lessons', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('teaches task lifecycle, async work, discovery, and tenant routing', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /current A2A guidance adds/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Tasks are the durable unit of work/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Design for progress and reconnects/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /An Agent Card is capability metadata/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Make routing explicit when agents are shared/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/Agent Cards describe capability and protocol metadata; they do not grant authority/i)).toBeInTheDocument();
    expect(screen.getByText(/Agent identity, Agent runtime, and delegated authority are separate/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /A2A learning hub/i })).toHaveAttribute(
      'href', 'https://a2a-protocol.org/latest/',
    );
    expect(screen.getByRole('link', { name: /^A2A spec$/i })).toHaveAttribute(
      'href', 'https://a2a-protocol.org/latest/specification/',
    );
  });

  it('explains each A2A delegation step and links provider-neutral and PingFederate guidance', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /follow the delegation step by step/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /separate the protocol from delegated authority/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /exchange the user subject for a generalist actor/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /exchange again for the specialist and its narrow permission/i })).toBeInTheDocument();
    });

    expect(screen.getByText(/the live token-chain events on this page are PingOne-backed/i)).toBeInTheDocument();
    expect(screen.getByText(/user-bound Exchange #1 token/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PingFederate authorization-code login flow/i })).toHaveAttribute(
      'href', 'https://docs.pingidentity.com/developer-resources/oauth_20_developer_guide/authorization-code-grant-types.html',
    );
    expect(screen.getAllByRole('link', { name: /PingFederate OAuth token-exchange guide/i })).toHaveLength(2);
    screen.getAllByRole('link', { name: /PingFederate OAuth token-exchange guide/i }).forEach((link) => {
      expect(link).toHaveAttribute(
        'href', 'https://docs.pingidentity.com/pingfederate/13.0/administrators_reference_guide/pf_config_oauth_token_exchange.html',
      );
    });
    expect(screen.getByRole('link', { name: /PingFederate token endpoint and client authentication/i })).toHaveAttribute(
      'href', 'https://docs.pingidentity.com/pingfederate/13.1/developers_reference_guide/pf_token_endpoint.html',
    );
    expect(screen.getByRole('link', { name: /AAIF production lessons/i })).toHaveAttribute(
      'href', 'https://aaif.io/blog/what-we-learned-putting-a2a-into-production',
    );
  });

  it('opens the matching A2A topic in the Education Hub', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /open A2A delegation in Education Hub/i }));

    expect(screen.getByLabelText('Education selection')).toHaveTextContent('a2a-delegation:what');
  });

  it('uses the current official A2A tutorials from the related learning rail', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /open the official A2A tutorials/i })).toHaveAttribute(
        'href',
        'https://a2a-protocol.org/latest/tutorials/',
      );
    });
  });
});

describe('A2A protocol learning page sections', () => {
  beforeEach(() => {
    localStorage.removeItem(A2A_SECTION_FOLD_STORAGE_NAME);
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wraps every numbered section in a details element that starts open', () => {
    const { container } = renderPage();
    const sections = container.querySelectorAll('details.a2l-section');
    expect(sections.length).toBeGreaterThanOrEqual(7);
    sections.forEach((section) => {
      expect(section.open).toBe(true);
      expect(section.querySelector(':scope > summary h2.a2l-h2')).not.toBeNull();
    });
  });

  it('shows each skill by name with its description and example, not just its id', () => {
    cardSummary.value = {
      name: 'Membership Specialist',
      version: '1.1.0',
      skills: ['sensitive_membership_details'],
      skillDetails: [{
        id: 'sensitive_membership_details',
        name: 'Sensitive membership details',
        description: 'Calls the tool once PingOne Authorize approves.',
        examples: ['review the sensitive membership details'],
      }],
      securitySchemes: ['pingoneBearer'],
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    };
    try {
      renderPage();
      expect(screen.getByText('Sensitive membership details')).toBeInTheDocument();
      expect(screen.getByText('Calls the tool once PingOne Authorize approves.')).toBeInTheDocument();
      expect(screen.getByText(/Example: review the sensitive membership details/)).toBeInTheDocument();
      expect(screen.getByText('sensitive_membership_details')).toBeInTheDocument();
    } finally {
      cardSummary.value = null;
    }
  });

  it('keeps the summary layout on a two-class selector so the PingOne nano stylesheet cannot override it', () => {
    // end-user-nano.css (cross-origin, scoped under .end-user-nano) sets summary to
    // list-item; a single-class rule loses and the chevron collapses to a sliver.
    expect(pageCss).toMatch(/\.a2l-section > \.a2l-summary \{[^}]*display: flex;/);
    expect(pageCss).not.toMatch(/(^|\n)\.a2l-summary \{/);
  });

  it('every section id on the page is known to the fold list', () => {
    const { container } = renderPage();
    const ids = [...container.querySelectorAll('details.a2l-section')].map((d) => d.id);
    expect(ids.sort()).toEqual([...A2A_SECTION_IDS].sort());
  });

  it('collapses a section from its heading and keeps the others open', async () => {
    const { container } = renderPage();
    const [first, second] = container.querySelectorAll('details.a2l-section');
    fireEvent.click(first.querySelector('summary'));
    await waitFor(() => expect(first.open).toBe(false));
    expect(second.open).toBe(true);
    fireEvent.click(first.querySelector('summary'));
    await waitFor(() => expect(first.open).toBe(true));
  });

  it('Collapse all folds every section and Expand all opens them again', async () => {
    const { container } = renderPage();
    const sections = () => [...container.querySelectorAll('details.a2l-section')];
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    await waitFor(() => expect(sections().every((s) => !s.open)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    await waitFor(() => expect(sections().every((s) => s.open)).toBe(true));
  });

  it('remembers folded sections between visits and ignores unknown ids', async () => {
    const first = renderPage();
    fireEvent.click(first.container.querySelector('details#card > summary'));
    await waitFor(() => expect(first.container.querySelector('details#card').open).toBe(false));
    expect(JSON.parse(localStorage.getItem(A2A_SECTION_FOLD_STORAGE_NAME))).toEqual(['card']);
    first.unmount();

    localStorage.setItem(A2A_SECTION_FOLD_STORAGE_NAME, JSON.stringify(['card', 'removed-long-ago']));
    const second = renderPage();
    expect(second.container.querySelector('details#card').open).toBe(false);
    expect(second.container.querySelector('details#layers').open).toBe(true);
  });
});

const json = (status, body, type = 'application/json') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => type },
  json: async () => body,
});

describe('A2A protocol learning page: Ping UI Standard', () => {
  beforeEach(() => {
    localStorage.removeItem(A2A_SECTION_FOLD_STORAGE_NAME);
    teachingPanes.value = [];
    chainDetail.value = { present: false };
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    teachingPanes.value = [];
    chainDetail.value = { present: false };
  });

  it('puts the note banner first inside the Ping UI page, and says the run is recorded', () => {
    const { container } = renderPage();
    const page = container.querySelector('.pu-page.a2l-page');
    expect(page).not.toBeNull();
    expect(page.firstElementChild.className).toContain('pu-banner-wrap');
    const banner = screen.getByTestId('a2l-banner');
    expect(banner).toHaveAttribute('role', 'note');
    expect(banner).toHaveTextContent('RECORDED RUN');
    expect(banner).toHaveTextContent(/captured 2026-09-01 for sporting-goods/);
  });

  it('has exactly one primary button, "Run the delegation", and every other button is a secondary', () => {
    const { container } = renderPage();
    const primaries = container.querySelectorAll('button.pu-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent('Run the delegation');
    expect(screen.getByRole('button', { name: 'Send without a bearer' }).className).not.toContain('pu-btn--primary');
    expect(screen.getByRole('button', { name: 'Expand all' }).className).toBe('pu-btn');
    expect(screen.getByTestId('a2l-theme-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('labels the Agent Card by what was checked: a failed fetch is never green', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('a2l-card-status')).toHaveTextContent('Unavailable'));
    expect(screen.getByTestId('a2l-card-status')).toHaveTextContent(/live fetch failed \(offline\)/);
    expect(screen.getByTestId('a2l-card-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('a2l-card').className).not.toContain('pu-card--live');
    expect(screen.getByTestId('a2l-card')).not.toHaveTextContent(/just now/);
  });

  it('shows a live Agent Card as a live fetch only after JSON came back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('agent-card.json')
        ? json(200, { name: 'Membership Specialist' })
        : Promise.reject(new Error('offline'))
    )));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('a2l-card-status')).toHaveTextContent('Live fetch'));
    expect(screen.getByTestId('a2l-card').className).toContain('pu-card--live');
  });

  it('treats a 200 text/html answer (no /a2a/ proxy) as a failed fetch, not a live card', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('agent-card.json') ? json(200, null, 'text/html') : Promise.reject(new Error('offline'))
    )));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('a2l-card-status')).toHaveTextContent('Unavailable'));
    expect(screen.getByTestId('a2l-card-status')).toHaveTextContent('text/html');
  });

  it('the no-bearer probe reports Refused on 401, keeps its own vertical, and uses aria-disabled while sending', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (init?.method === 'POST') { await pending; return json(401, { error: 'unauthorized' }); }
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();
    const button = screen.getByTestId('a2l-probe-btn');
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(screen.getByTestId('a2l-probe-status')).toHaveTextContent('Sending');
    await user.click(button); // ignored while pending
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.getByTestId('a2l-probe-status')).toHaveTextContent('Refused'));
    expect(screen.getByTestId('a2l-probe-status')).toHaveTextContent('HTTP 401');
    expect(screen.getByTestId('a2l-probe-status')).toHaveAttribute('role', 'status');
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('the probe does not call a 200 a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => (
      init?.method === 'POST' ? json(200, { ok: true }) : Promise.reject(new Error('offline'))
    )));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();
    await user.click(screen.getByTestId('a2l-probe-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-probe-status')).toHaveTextContent('Unexpected'));
    expect(screen.getByTestId('a2l-probe-status')).not.toHaveTextContent('Refused');
  });

  it('"Run the delegation" keeps keyboard focus while running (aria-disabled, not disabled)', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') { await pending; return json(401, { need_auth: true }); }
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();
    const button = screen.getByTestId('a2l-run-btn');
    button.focus();
    await user.click(button);
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveFocus();
    expect(button).toHaveTextContent('Running…');
    expect(screen.getByTestId('a2l-run-status')).toHaveTextContent('Running');
    release();
    await waitFor(() => expect(screen.getByTestId('signin-strip')).toBeInTheDocument());
    expect(button).toHaveFocus();
    // Signed out: the page says so inline and stays on the recorded run (no redirect, no result swap).
    expect(screen.getByTestId('a2l-run-status')).toHaveTextContent('Sign-in needed');
    expect(screen.getByTestId('a2l-run-status')).toHaveTextContent(/still show the recorded run/);
    expect(screen.getByTestId('a2l-run-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('a2l-banner')).toHaveTextContent('RECORDED RUN');
    expect(document.querySelectorAll('button.pu-btn--primary')).toHaveLength(1);
  });

  it('a live run is called a live run for the vertical it ran for, in the banner and the status line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') return json(200, { tokenEvents: [{ id: 'user-token' }] });
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-run-status')).toHaveTextContent('Live run'));
    expect(screen.getByTestId('a2l-run-status')).toHaveTextContent('for sporting-goods');
    expect(screen.getByTestId('a2l-banner')).toHaveTextContent('LIVE RUN');
    expect(screen.getByTestId('a2l-banner')).not.toHaveTextContent(/captured 2026-09-01/);
  });

  it('panes name what they are, and a recorded run never claims a browser-made request', () => {
    teachingPanes.value = [
      { key: 'a', layer: 'wire', title: 'Agent Card · discovery', provenance: 'live-http', caption: 'A real HTTP request, made from your browser just now.', body: { x: 1 } },
      { key: 'b', layer: 'identity', title: 'Exchange #1 — request', provenance: 'reconstructed', caption: 'Reconstructed parameter summary.', body: { y: 1 } },
    ];
    renderPage();
    expect(screen.getByText('Recorded · HTTP on the wire')).toBeInTheDocument();
    expect(screen.getByText('Recorded · Reconstructed')).toBeInTheDocument();
    expect(screen.queryByText(/just now/)).toBeNull();
    expect(screen.getByText(/Your browser did not send it/)).toBeInTheDocument();
    expect(screen.queryByText('Recorded run', { selector: '.pu-chip' })).not.toBeNull();
  });

  it('implementation status chips carry the word and are not green', () => {
    const { container } = renderPage();
    const chips = container.querySelectorAll('[data-testid="a2l-status-card"] .pu-chip');
    expect(chips.length).toBeGreaterThan(0);
    chips.forEach((chip) => {
      expect(chip.textContent.trim().length).toBeGreaterThan(0);
      expect(chip.className).not.toContain('pu-chip--ok');
    });
  });

  it('the banner follows the Agent Card check: failed fetch is not described as a real request that worked', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId('a2l-card-status')).toHaveTextContent('Unavailable'));
    const banner = screen.getByTestId('a2l-banner');
    expect(banner).toHaveTextContent(/did not come back as JSON/);
    expect(banner).not.toHaveTextContent(/came back as JSON\./);
    expect(banner).not.toHaveTextContent(/when the page loads/);
  });

  it('the banner says the Agent Card request came back as JSON only after it did', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url).includes('agent-card.json') ? json(200, { name: 'M' }) : Promise.reject(new Error('offline'))
    )));
    renderPage();
    await waitFor(() => expect(screen.getByTestId('a2l-banner')).toHaveTextContent(/and it came back as JSON/));
  });

  it('the banner reads the agent hop from the run: in-process, over HTTP, or not reported', async () => {
    const liveRun = () => vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') return json(200, { tokenEvents: [{ id: 'user-token' }] });
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();

    chainDetail.value = { present: true, protocol: { mode: 'in-process' }, hops: [] };
    const first = renderPage();
    expect(screen.getByTestId('a2l-banner')).toHaveTextContent(/In the recorded run the hop between the two agents ran in-process/);
    first.unmount();

    liveRun();
    chainDetail.value = { present: true, protocol: { mode: 'http' }, hops: [] };
    const second = renderPage();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-banner')).toHaveTextContent('LIVE RUN'));
    expect(screen.getByTestId('a2l-banner')).toHaveTextContent(/In this run the hop between the two agents went over HTTP/);
    expect(screen.getByTestId('a2l-banner')).not.toHaveTextContent(/in-process, so no HTTP/);
    second.unmount();

    liveRun();
    chainDetail.value = { present: true, protocol: null, hops: [] };
    renderPage();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-banner')).toHaveTextContent('LIVE RUN'));
    expect(screen.getByTestId('a2l-banner')).toHaveTextContent(/did not report which happened/);
  });

  it.each([
    [{ metadata: { framework: 'llama.cpp' }, agentHeader: '[A2A ORCHESTRATOR - LLM (llama.cpp)]' }, /llama\.cpp decided the delegation/],
    [{ metadata: { framework: 'heuristic' }, agentHeader: '[A2A ORCHESTRATOR - Heuristics]' }, /keyword heuristic decided, with no model call/],
    [{ metadata: { framework: 'heuristic' }, agentHeader: '[A2A ORCHESTRATOR - Heuristic Fallback]' }, /llama\.cpp call failed and the BFF fell back/],
    [undefined, /did not say which engine decided/],
  ])('a live run names the engine the BFF reported (%#), not the mode that was asked for', async (decision, expected) => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') {
        return json(200, { tokenEvents: [{ id: 'user-token' }], delegationDecision: decision });
      }
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage(); // default mode is llm: a fallback must still be called a fallback
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-run-status')).toHaveTextContent('Live run'));
    expect(screen.getByTestId('a2l-run-status')).toHaveTextContent(expected);
  });

  it('a run failure is explained, sits in a live region that exists before it fills, and does not leak into another mode', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') return json(502, { error: 'proxy_error' });
      return Promise.reject(new Error('offline'));
    }));
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();
    const region = screen.getByTestId('a2l-run-error');
    expect(region).toHaveAttribute('role', 'alert');
    expect(region).toBeEmptyDOMElement();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(region).toHaveTextContent('Run failed'));
    expect(screen.getByTestId('a2l-run-error')).toBe(region); // same node: it was not mounted with its content
    expect(region).toHaveTextContent(/answered HTTP 502 and returned no token chain: proxy_error/);
    await user.click(screen.getByRole('radio', { name: 'Heuristics' }));
    expect(region).toBeEmptyDOMElement();
  });

  it('a non-JSON body and a network error each get a sentence, not a parser or fetch message alone', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url) === '/api/a2a/init') return json(200, {});
      if (String(url) === '/api/a2a/message') return { ok: false, status: 502, headers: { get: () => 'text/plain' }, json: async () => { throw new SyntaxError('Unexpected token'); } };
      return Promise.reject(new Error('offline'));
    }));
    const first = renderPage();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-run-error')).toHaveTextContent(/HTTP 502 with a body that was not JSON/));
    expect(screen.getByTestId('a2l-run-error')).not.toHaveTextContent('Unexpected token');
    first.unmount();

    vi.stubGlobal('fetch', vi.fn(async (url) => (
      String(url) === '/api/a2a/init' ? json(200, {}) : Promise.reject(new Error('Failed to fetch'))
    )));
    renderPage();
    await user.click(screen.getByTestId('a2l-run-btn'));
    await waitFor(() => expect(screen.getByTestId('a2l-run-error')).toHaveTextContent(/request did not complete \(Failed to fetch\)/));
  });

  it('scopes every rule in the page sheet: no selector can match another page', () => {
    const rules = pageCss.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    const selectors = [...rules.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    // Every selector carries a page-unique a2l- class (or the page root), so nothing here restyles another page.
    const unscoped = selectors.filter((sel) => !/a2l-/.test(sel));
    expect(unscoped).toEqual([]);
  });

  it('keeps no inline colour, no violet and no vertical token in the page sheet', () => {
    const rules = pageCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/--app-primary-red|--brand-|--theme-accent/);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(rules).not.toMatch(/prefers-color-scheme/);
  });
});
