import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import TokenExchangePanel from '../TokenExchangePanel';
import { EducationUIProvider } from '../../../context/EducationUIContext';
import { getCachedJson } from '../../../services/cachedStatusService';

vi.mock('../../../services/cachedStatusService', () => ({
  getCachedJson: vi.fn(),
}));

// Header/payload for a JWT whose payload segment contains base64url-only
// characters ('-'/'_') that plain atob() rejects.
// Payload decodes to: {"sub":"u10","name":"Jane Doe #10","roles":["admin","user"],"note":"transfer >= $37"}
const BASE64URL_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MTAiLCJuYW1lIjoiSmFuZSBEb2UgIzEwIiwicm9sZXMiOlsiYWRtaW4iLCJ1c2VyIl0sIm5vdGUiOiJ0cmFuc2ZlciA-PSAkMzcifQ.SIGNATURE'; // gitleaks:allow

function renderPanel() {
  return render(
    <EducationUIProvider>
      <TokenExchangePanel isOpen onClose={() => {}} initialTabId="live" />
    </EducationUIProvider>
  );
}

describe('TokenExchangePanel — Live Tokens tab', () => {
  it('decodes a base64url-encoded access token instead of hiding the decoded-token block', async () => {
    getCachedJson.mockResolvedValue({
      data: { authenticated: true, accessToken: BASE64URL_TOKEN, expiresAt: null },
    });

    const { container } = renderPanel();

    await waitFor(() =>
      expect(screen.getByText('User Token — decoded claims')).toBeInTheDocument()
    );
    expect(container.textContent).toContain('u10');
    expect(container.textContent).toContain('Jane Doe #10');
  });
});
