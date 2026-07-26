import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

vi.mock('../VerdictPair.css', () => ({}), { virtual: true });

import VerdictPair from '../VerdictPair';

describe('VerdictPair', () => {
  it('shows no result before a run', () => {
    render(<VerdictPair expected="PERMIT" actual={null} state={null} running={false} />);
    expect(screen.getByTestId('verdict-expected')).toHaveTextContent('PERMIT');
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('—');
    expect(screen.queryByTestId('verdict-match')).toBeNull();
  });

  it('shows a running state without claiming a result', () => {
    render(<VerdictPair expected="PERMIT" actual={null} state={null} running />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('Running');
    expect(screen.queryByTestId('verdict-match')).toBeNull();
  });

  it('marks a verified run as matched', () => {
    render(<VerdictPair expected="PERMIT" actual="PERMIT" state="verified" running={false} />);
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('matched');
  });

  it('marks a denied-as-expected run as matched', () => {
    render(<VerdictPair expected="DENY" actual="DENY" state="denied-as-expected" running={false} />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('DENY');
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('matched');
  });

  it('does not claim success on a mismatch', () => {
    render(<VerdictPair expected="DENY" actual="PERMIT" state="mismatch" running={false} />);
    const match = screen.getByTestId('verdict-match');
    expect(match).toHaveTextContent('not proven');
    expect(match).not.toHaveTextContent('matched');
  });

  it('reports an incomplete run as unproven, not as a pass', () => {
    render(<VerdictPair expected="DENY" actual={null} state="incomplete" running={false} />);
    expect(screen.getByTestId('verdict-actual')).toHaveTextContent('Unproven');
    expect(screen.getByTestId('verdict-match')).toHaveTextContent('not proven');
  });
});
