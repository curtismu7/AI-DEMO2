import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

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

import A2AProtocolLearningPage from './A2AProtocolLearningPage';

describe('A2A protocol learning lessons', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('teaches task lifecycle, async work, discovery, and tenant routing', async () => {
    render(
      <MemoryRouter>
        <A2AProtocolLearningPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /current A2A guidance adds/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Tasks are the durable unit of work/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Design for progress and reconnects/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /An Agent Card is capability metadata/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Make routing explicit when agents are shared/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /A2A learning hub/i })).toHaveAttribute(
      'href', 'https://a2a-protocol.org/latest/',
    );
  });
});
