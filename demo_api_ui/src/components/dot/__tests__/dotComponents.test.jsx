import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DotToolCard from '../DotToolCard';
import DotGovernsPanel from '../DotGovernsPanel';
import DotPersonaCard from '../DotPersonaCard';

afterEach(cleanup);

describe('DotToolCard', () => {
  it('shows the tool name and verdict pill; details only when data exists', () => {
    const { rerender } = render(<DotToolCard item={{ name: 'book_flight', verdict: 'PERMIT' }} />);
    expect(screen.getByText('book_flight')).toBeTruthy();
    expect(screen.getByText('PERMIT')).toBeTruthy();
    expect(document.querySelector('details')).toBeNull();
    rerender(<DotToolCard item={{ name: 'transfer_miles', verdict: 'DENY', reason: 'Not delegated.' }} />);
    expect(screen.getByText('DENY')).toBeTruthy();
    expect(screen.getByText('Not delegated.')).toBeTruthy();
    expect(document.querySelector('details')).toBeTruthy();
  });
  it('renders no pill for an unknown verdict', () => {
    render(<DotToolCard item={{ name: 'x', verdict: undefined }} />);
    expect(screen.queryByText('PERMIT')).toBeNull();
  });
});

describe('DotGovernsPanel', () => {
  const persona = { agentName: 'Dot', agentId: 'abc', scopes: ['miles:read'], loaded: true };
  it('tallies the last three calls and shows mode', () => {
    const cards = [{ verdict: 'PERMIT' }, { verdict: 'PERMIT' }, { verdict: 'DENY' }, { verdict: 'PERMIT' }];
    render(<DotGovernsPanel cards={cards} persona={persona} mode="heuristics" />);
    expect(screen.getByText('2 PERMIT · 1 DENY')).toBeTruthy(); // last three of four: PERMIT, DENY, PERMIT
    expect(screen.getByText(/Heuristics/)).toBeTruthy();
  });
  it('says no calls yet when empty', () => {
    render(<DotGovernsPanel cards={[]} persona={persona} mode="llm" />);
    expect(screen.getByText('No calls yet')).toBeTruthy();
  });
});

describe('DotPersonaCard', () => {
  it('shows real values', () => {
    render(<DotPersonaCard identity="a@b.com" persona={{ agentName: 'Dot', agentId: 'ag-1', scopes: ['miles:read', 'flights:book'], loaded: true }} />);
    expect(screen.getByText('a@b.com')).toBeTruthy();
    expect(screen.getByText('ag-1')).toBeTruthy();
    expect(screen.getByText('miles:read · flights:book')).toBeTruthy();
  });
  it('never invents values: missing data shows a dash and no scopes pill', () => {
    render(<DotPersonaCard identity="" persona={{ agentName: null, agentId: null, scopes: [], loaded: true }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Scopes/)).toBeNull();
    expect(screen.queryByText(/carol|7f3a/i)).toBeNull();
  });
});
