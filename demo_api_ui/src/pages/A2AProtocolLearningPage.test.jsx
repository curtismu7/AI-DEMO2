import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import {
  EducationUIProvider,
  useEducationUI,
} from '../context/EducationUIContext';
import A2AProtocolLearningPage from './A2AProtocolLearningPage';
import { A2A_SECTION_FOLD_STORAGE_NAME, A2A_SECTION_IDS } from '../utils/a2aSectionFold';

vi.mock('../context/ThemeContext', () => ({
  useThemeOptional: () => ({ darkMode: false, toggleDarkMode: vi.fn() }),
}));

vi.mock('../components/SignInPrompt', () => ({ default: () => null }));

vi.mock('../utils/a2aChainDetail', () => ({
  buildA2aChainDetail: () => ({ present: false }),
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

vi.mock('./a2aTeachingPanes', () => ({
  buildA2aTeachingPanes: () => [],
  summarizeAgentCard: () => cardSummary.value,
  summarizeActChain: () => null,
  LAYER: { IDENTITY: 'identity', WIRE: 'wire' },
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
