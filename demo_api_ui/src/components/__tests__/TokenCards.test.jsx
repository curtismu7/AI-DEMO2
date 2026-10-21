import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TokenCards, { hasTokenCards, pickTokenCards } from '../TokenCards';

const events = [
  { id: 'user-token', claims: { sub: 'u-1', aud: 'ai-demo-bff', scope: 'openid profile' } },
  { id: 'two-ex-agent-actor', claims: { client_id: 'agent-9', aud: 'agentgateway', scope: 'agent:invoke' } },
  { id: 'two-ex-final-token', claims: { sub: 'u-1', act: { sub: 'agent-9' }, aud: ['https://mcp', 'https://alt'], scope: 'gateway:mcp:invoke' } },
  { id: 'gw-authorize', status: 'permit' },
];

describe('TokenCards', () => {
  it('reads the three tokens from the run\'s events, with the act claim on the exchanged one', () => {
    const [user, actor, exchanged] = pickTokenCards(events);
    expect(user.data).toContainEqual(['sub', 'u-1']);
    expect(actor.data).toContainEqual(['client', 'agent-9']);
    expect(exchanged.data).toContainEqual(['act.sub', 'agent-9']);
    expect(exchanged.data).toContainEqual(['aud', 'https://mcp, https://alt']);
  });

  it('renders one card per token with its claims', () => {
    render(<TokenCards events={events} />);
    expect(screen.getByRole('group', { name: 'Tokens in this request' })).toBeTruthy();
    expect(screen.getByText('User token')).toBeTruthy();
    expect(screen.getByText('Actor token')).toBeTruthy();
    expect(screen.getByText('Exchanged token')).toBeTruthy();
    // the agent shows up twice by design: as the actor token's client and as the exchanged token's act.sub
    expect(screen.getAllByText('agent-9', { selector: 'dd' })).toHaveLength(2);
  });

  it('says so when a token was not issued, instead of inventing claims', () => {
    render(<TokenCards events={[events[0]]} />);
    expect(screen.getAllByText('Not issued in this run')).toHaveLength(2);
  });

  it('renders nothing, and reports no cards, when the run issued none of the three tokens', () => {
    expect(hasTokenCards([])).toBe(false);
    expect(hasTokenCards([{ id: 'gw-authorize', status: 'permit' }])).toBe(false);
    expect(hasTokenCards(undefined)).toBe(false);
    const { container } = render(<TokenCards events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('ignores a token event that carries no decoded claims', () => {
    expect(hasTokenCards([{ id: 'user-token' }])).toBe(false);
  });
});
