import React from 'react';
import { render, screen } from '@testing-library/react';
import { TokenInspectModal } from '../TokenInspectModal';

// Header/payload for a JWT whose payload segment is realistic length and
// contains base64url-only characters ('-'/'_') that plain atob() rejects.
// Payload decodes to: {"sub":"u10","name":"Jane Doe #10","roles":["admin","user"],"note":"transfer >= $37"}
const BASE64URL_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1MTAiLCJuYW1lIjoiSmFuZSBEb2UgIzEwIiwicm9sZXMiOlsiYWRtaW4iLCJ1c2VyIl0sIm5vdGUiOiJ0cmFuc2ZlciA-PSAkMzcifQ.SIGNATURE'; // gitleaks:allow

describe('TokenInspectModal', () => {
  it('decodes a base64url-encoded JWT payload instead of showing "(Unable to decode)"', () => {
    const exchange = {
      exchangeType: 'token-exchange',
      timestamp: '2026-08-15T00:00:00Z',
      subjectToken: BASE64URL_TOKEN,
      resultToken: BASE64URL_TOKEN,
    };
    const { container } = render(
      <TokenInspectModal exchange={exchange} isOpen onClose={() => {}} />
    );

    expect(screen.queryByText('(Unable to decode)')).not.toBeInTheDocument();
    expect(container.textContent).toContain('u10');
    expect(container.textContent).toContain('Jane Doe #10');
  });
});
