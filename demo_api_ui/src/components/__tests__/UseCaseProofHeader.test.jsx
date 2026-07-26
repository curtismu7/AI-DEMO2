import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../UseCaseProofHeader.css', () => ({}), { virtual: true });

import UseCaseProofHeader from '../UseCaseProofHeader';

const UC = {
  id: 'UC1',
  title: 'Delegated access with proof',
  buyerStory: 'The agent acts for a named human, provably, at every hop.',
  whatToSay: 'show my balance',
  owasp: { threats: ['T1'], sections: ['S2'] },
};

describe('UseCaseProofHeader', () => {
  it('renders the claim, the phrase to say, and the OWASP badge', () => {
    render(<UseCaseProofHeader uc={UC} beat={null} />);
    expect(screen.getByText(UC.title)).toBeInTheDocument();
    expect(screen.getByText(UC.buyerStory)).toBeInTheDocument();
    expect(screen.getByText(/show my balance/)).toBeInTheDocument();
    expect(screen.getByText('OWASP ASI')).toBeInTheDocument();
  });

  it('renders nothing when no use case is selected', () => {
    const { container } = render(<UseCaseProofHeader uc={null} beat={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('omits the OWASP badge when the use case has none', () => {
    render(<UseCaseProofHeader uc={{ ...UC, owasp: null }} beat={null} />);
    expect(screen.queryByText('OWASP ASI')).toBeNull();
  });

  it('falls back to the trigger text when whatToSay is absent', () => {
    render(
      <UseCaseProofHeader
        uc={{ ...UC, whatToSay: null, trigger: { type: 'chip', text: 'show my accounts' } }}
        beat={null}
      />,
    );
    expect(screen.getByText(/show my accounts/)).toBeInTheDocument();
  });

  it('renders no presenter line without a beat', () => {
    render(<UseCaseProofHeader uc={UC} beat={null} />);
    expect(screen.queryByText(/Presenter line/i)).toBeNull();
  });
});
