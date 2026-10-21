import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import GateChips from '../GateChips';

const gates = [
  { id: 'mfa', name: 'AuthN: MFA Required', status: 'permit' },
  { id: 'gw', name: 'Gateway: Token Validation', status: 'checking' },
  { id: 'authz', name: 'PingOne Authorize', status: 'waiting' },
];

describe('GateChips', () => {
  it('renders one chip per gate, numbered in order', () => {
    render(<GateChips gates={gates} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Gate 1')).toBeTruthy();
    expect(screen.getByText('Gate 3')).toBeTruthy();
    expect(screen.getByText('AuthN: MFA Required')).toBeTruthy();
  });

  it('labels each gate with its state and marks a passed gate', () => {
    const { container } = render(<GateChips gates={gates} />);
    expect(screen.getByText(/Passed/)).toBeTruthy();
    expect(screen.getByText('Checking…')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(container.querySelector('.gate-chips__chip--permit')).not.toBeNull();
  });

  it('shows a denied gate as denied, never as passed', () => {
    const { container } = render(<GateChips gates={[{ id: 'authz', name: 'PingOne Authorize', status: 'deny' }]} />);
    expect(screen.getByText('Denied')).toBeTruthy();
    expect(container.querySelector('.gate-chips__chip--permit')).toBeNull();
  });
});
