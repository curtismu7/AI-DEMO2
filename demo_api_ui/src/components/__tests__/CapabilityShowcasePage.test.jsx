import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CapabilityShowcasePage from '../CapabilityShowcasePage';

const GROUPS = [
  { id: 'a', label: 'Group A' },
  { id: 'b', label: 'Group B' },
];
const LEDGER = [
  { id: 'cap-1', group: 'a', title: 'Capability One', oneLiner: 'Does thing one.', evidence: { code: 'file.js:1' } },
  { id: 'cap-2', group: 'b', title: 'Capability Two', oneLiner: 'Does thing two.', evidence: { code: 'file.js:2' } },
  { id: 'cap-3', group: 'a', title: 'Capability Three', oneLiner: 'Does thing three.', evidence: { code: 'file.js:3' } },
];

describe('CapabilityShowcasePage', () => {
  it('renders the title and intro', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Test Product' })).toBeInTheDocument();
    expect(screen.getByText('Test intro copy.')).toBeInTheDocument();
  });

  it('renders one card per ledger entry', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByTestId('cap-card-cap-1')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-cap-2')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-cap-3')).toBeInTheDocument();
  });

  it('groups cards under the correct heading in group order', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    const groupA = screen.getByText('Group A').closest('section');
    const groupB = screen.getByText('Group B').closest('section');
    expect(within(groupA).getByText('Capability One')).toBeInTheDocument();
    expect(within(groupA).getByText('Capability Three')).toBeInTheDocument();
    expect(within(groupA).queryByText('Capability Two')).not.toBeInTheDocument();
    expect(within(groupB).getByText('Capability Two')).toBeInTheDocument();
  });

  it('renders each card’s one-liner and evidence citation', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByText('Does thing one.')).toBeInTheDocument();
    expect(screen.getByText('file.js:1')).toBeInTheDocument();
  });
});
