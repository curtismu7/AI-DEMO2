import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import {
  EducationUIProvider,
  useEducationUI,
} from '../context/EducationUIContext';

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

vi.mock('./a2aTeachingPanes', () => ({
  buildA2aTeachingPanes: () => [],
  summarizeAgentCard: () => null,
  summarizeActChain: () => null,
  LAYER: { IDENTITY: 'identity', WIRE: 'wire' },
}));

vi.mock('../components/A2AArchitectureDiagram', () => ({
  default: ({ onClose }) => (
    <div role="dialog" aria-label="A2A implementation architecture">
      <button type="button" onClick={onClose}>Close architecture</button>
    </div>
  ),
}));

import A2AProtocolLearningPage from './A2AProtocolLearningPage';

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

  it('opens the implementation architecture diagram from the learning hub', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /show A2A implementation architecture/i }));
    expect(screen.getByRole('dialog', { name: /A2A implementation architecture/i })).toBeInTheDocument();
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
