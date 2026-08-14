import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SecurityRail from '../SecurityRail';

const baseGates = [
  { id: 'mfa', name: 'AuthN: MFA Required', desc: 'BFF checks acr claim', icon: '🔐', status: 'permit' },
  { id: 'gw', name: 'Gateway: Token Validation', desc: 'Audience · act claim · introspection', icon: '🪟', status: 'checking' },
  { id: 'authz', name: 'PingOne Authorize', desc: 'Policy evaluation', icon: '✅', status: 'waiting' },
];

const baseActClaim = {
  sub: 'user:alice@demo.ping',
  act: { sub: 'agent:privilege-ai-7f2a' },
  scope: 'airlines:read airlines:write',
  acr: 'urn:acr:mfa',
};

describe('SecurityRail', () => {
  it('renders all three gate names', () => {
    render(<SecurityRail gates={baseGates} actClaim={null} tokenEvents={[]} onReplay={vi.fn()} />);
    expect(screen.getByText('AuthN: MFA Required')).toBeTruthy();
    expect(screen.getByText('Gateway: Token Validation')).toBeTruthy();
    expect(screen.getByText('PingOne Authorize')).toBeTruthy();
  });

  it('renders gate statuses', () => {
    render(<SecurityRail gates={baseGates} actClaim={null} tokenEvents={[]} onReplay={vi.fn()} />);
    expect(screen.getByText('PERMIT')).toBeTruthy();
    expect(screen.getByText('CHECKING…')).toBeTruthy();
    expect(screen.getByText('WAITING')).toBeTruthy();
  });

  it('renders act claim when provided', () => {
    render(<SecurityRail gates={baseGates} actClaim={baseActClaim} tokenEvents={[]} onReplay={vi.fn()} />);
    expect(screen.getByText(/alice@demo.ping/)).toBeTruthy();
    expect(screen.getByText(/privilege-ai-7f2a/)).toBeTruthy();
  });

  it('renders token events', () => {
    const events = [
      { id: 'e1', label: 'MFA token verified', description: 'acr = urn:acr:mfa', status: 'success' },
      { id: 'e2', label: 'Personal agent lookup', description: 'agent found', status: 'success' },
    ];
    render(<SecurityRail gates={baseGates} actClaim={null} tokenEvents={events} onReplay={vi.fn()} />);
    expect(screen.getByText('MFA token verified')).toBeTruthy();
    expect(screen.getByText('Personal agent lookup')).toBeTruthy();
  });

  it('calls onReplay when Replay button clicked', () => {
    const onReplay = vi.fn();
    render(<SecurityRail gates={baseGates} actClaim={null} tokenEvents={[]} onReplay={onReplay} />);
    fireEvent.click(screen.getByText(/Replay/i));
    expect(onReplay).toHaveBeenCalled();
  });

  it('shows "deny" status label for deny gate', () => {
    const gates = [{ ...baseGates[0], status: 'deny' }];
    render(<SecurityRail gates={gates} actClaim={null} tokenEvents={[]} onReplay={vi.fn()} />);
    expect(screen.getByText('DENY')).toBeTruthy();
  });
});
