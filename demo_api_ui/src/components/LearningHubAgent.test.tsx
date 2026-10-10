import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LearningHubAgent from './LearningHubAgent';
import { SessionTokenProvider } from '../context/SessionTokenContext';
import * as sessionResolver from '../services/sessionResolver';

vi.mock('../services/codeSearchAPI', () => ({
  askCodeSearch: vi.fn().mockRejectedValue(new Error('authentication_required — must not be reached as a guest')),
}));

vi.mock('../services/sessionResolver', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveSessionExpiry: vi.fn() };
});

function renderAgent() {
  return render(
    <SessionTokenProvider>
      <LearningHubAgent />
    </SessionTokenProvider>,
  );
}

describe('LearningHubAgent', () => {
  it('disables the agent controls for a guest instead of surfacing the 401', async () => {
    vi.mocked(sessionResolver.resolveSessionExpiry).mockResolvedValue({ sessionType: null, expiresAt: null });
    renderAgent();
    expect(await screen.findByText(/sign in to ask the learning hub agent/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Ask the Learning Hub agent')).toBeDisabled();
    expect(screen.getByRole('button', { name: /ask agent/i })).toBeDisabled();
  });
});
