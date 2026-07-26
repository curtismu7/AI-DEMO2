/**
 * CibaStepUpFlowPanel — CIBA education panel (UC22).
 *
 * Static content: 5-step flow, 4-channel approval table, live session events.
 * Uses useTokenChainOptional to surface any ciba-granted tokens from this session.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import CibaStepUpFlowPanel from '../CibaStepUpFlowPanel';

// Stub context hook — returns controlled token events
vi.mock('../../context/TokenChainContext', () => ({
  useTokenChainOptional: vi.fn(() => null),
}));

import { useTokenChainOptional } from '../../context/TokenChainContext';

describe('CibaStepUpFlowPanel — static content', () => {
  it('renders all 5 flow steps', () => {
    render(<CibaStepUpFlowPanel />);
    // Steps 1 and 5 share the 'Browser → BFF' actor label
    const browserBff = screen.getAllByText('Browser → BFF');
    expect(browserBff.length).toBe(2);
    expect(screen.getByText('BFF → Browser')).toBeInTheDocument();
    expect(screen.getByText('Browser → BFF → PingOne')).toBeInTheDocument();
    expect(screen.getByText('User (out-of-band)')).toBeInTheDocument();
  });

  it('renders step titles for the full CIBA flow', () => {
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText('High-value transfer attempt')).toBeInTheDocument();
    expect(screen.getByText('428 step-up required')).toBeInTheDocument();
    expect(screen.getByText(/POST \/api\/auth\/ciba\/initiate/)).toBeInTheDocument();
    expect(screen.getByText('Approve on the bound channel')).toBeInTheDocument();
    expect(screen.getByText(/Poll \/api\/auth\/ciba\/poll/)).toBeInTheDocument();
  });

  it('renders the 4-channel approval table with correct rows', () => {
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText(/Email approve-link \/ OTP/)).toBeInTheDocument();
    expect(screen.getByText('SMS OTP')).toBeInTheDocument();
    expect(screen.getByText(/FIDO2 \/ passkey/)).toBeInTheDocument();
    expect(screen.getByText('Mobile push')).toBeInTheDocument();
  });

  it('renders the channel table headers', () => {
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText('Channel')).toBeInTheDocument();
    expect(screen.getByText('User experience')).toBeInTheDocument();
    expect(screen.getByText('Mobile app required?')).toBeInTheDocument();
  });
});

describe('CibaStepUpFlowPanel — session events', () => {
  it('shows "no CIBA step-up" empty state when there are no ciba events', () => {
    useTokenChainOptional.mockReturnValue({ events: [] });
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText(/No CIBA step-up has occurred/i)).toBeInTheDocument();
  });

  it('shows empty state when tokenChain is null', () => {
    useTokenChainOptional.mockReturnValue(null);
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText(/No CIBA step-up has occurred/i)).toBeInTheDocument();
  });

  it('shows non-ciba events in the empty state (they are filtered out)', () => {
    useTokenChainOptional.mockReturnValue({
      events: [{ id: 'ev-1', grantedVia: 'par', description: 'PAR token' }],
    });
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText(/No CIBA step-up has occurred/i)).toBeInTheDocument();
    expect(screen.queryByText('PAR token')).not.toBeInTheDocument();
  });

  it('renders live ciba event description and scopes', () => {
    useTokenChainOptional.mockReturnValue({
      events: [
        {
          id: 'ev-ciba-1',
          grantedVia: 'ciba',
          description: 'CIBA backchannel grant',
          scopes: ['openid', 'create_transfer'],
          timestamp: '2024-06-15T14:30:00Z',
        },
      ],
    });
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText('CIBA backchannel grant')).toBeInTheDocument();
    expect(screen.getByText(/openid, create_transfer/)).toBeInTheDocument();
    expect(screen.queryByText(/No CIBA step-up/i)).not.toBeInTheDocument();
  });

  it('renders multiple live ciba events', () => {
    useTokenChainOptional.mockReturnValue({
      events: [
        { id: 'ev-1', grantedVia: 'ciba', description: 'First approval' },
        { id: 'ev-2', grantedVia: 'ciba', description: 'Second approval' },
      ],
    });
    render(<CibaStepUpFlowPanel />);
    expect(screen.getByText('First approval')).toBeInTheDocument();
    expect(screen.getByText('Second approval')).toBeInTheDocument();
  });
});
