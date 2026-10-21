import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import TokenCards, { hasTokenCards, pickIntentToken, pickTokenCards } from '../TokenCards';

const t = Math.floor(Date.now() / 1000);
const events = [
  { id: 'user-token', alg: 'RS256', hiddenClaims: ['amr', 'sid'], jwtFullDecode: { header: { alg: 'RS256' }, claims: { sub: 'u-1' } },
    claims: { iss: 'https://idp/as', sub: 'u-1', name: 'Pat Rivera', email: 'pat@x.example', aud: 'ai-demo-bff', scope: 'openid profile accounts:read', acr: 'Multi_Factor', auth_time: t - 100, iat: t - 60, exp: t + 540, jti: '5f2c0b7e91a1a91d' } },
  { id: 'two-ex-agent-actor', claims: { client_id: 'agent-9', aud: 'agentgateway', scope: 'agent:invoke', iat: t - 10, exp: t + 290 } },
  { id: 'two-ex-final-token', claims: { sub: 'u-1', act: { sub: 'agent-9' }, aud: ['https://mcp', 'https://alt'], scope: 'gateway:mcp:invoke', iat: t - 9, exp: t + 291 } },
  { id: 'intent-token', claims: { intent: 'get_loyalty_status', vertical: 'airlines', permitted_tools: ['get_loyalty_status'], prompt_hash: '7c1e55a2b40a99d1', confidence: 0.7 } },
  { id: 'gw-authorize', status: 'permit' },
];
const row = (card, label) => card.rows.find((r) => r.label === label)?.value;

describe('pickTokenCards', () => {
  const [user, actor, exchanged] = pickTokenCards(events);

  it('reads each token\'s claims from the run, never inventing any', () => {
    expect(row(user, 'sub')).toBe('u-1');
    expect(row(user, 'name')).toBe('Pat Rivera · pat@x.example');
    expect(row(actor, 'client')).toBe('agent-9');
    expect(row(exchanged, 'act.sub')).toBe('agent-9');
    expect(row(exchanged, 'aud')).toBe('https://mcp, https://alt');
  });

  it('marks multi-factor sign-in on the user token and shows when it happened', () => {
    expect(row(user, 'acr')).toMatch(/Multi_Factor ✓ MFA · auth_time \d/);
  });

  it('carries timing, algorithm, jti, hidden-claim names and the decoded JWT', () => {
    expect(user.expires - user.issued).toBe(600);
    expect(user.alg).toBe('RS256');
    expect(user.jti).toBe('5f2c0b7e91a1a91d');
    expect(user.hidden).toEqual(['amr', 'sid']);
    expect(user.decoded.header.alg).toBe('RS256');
  });

  it('describes the delegation on the exchanged token and how far the scope narrowed', () => {
    expect(exchanged.chain.agent).toBe('agent-9');
    expect(exchanged.chain.customer).toContain('u-1');
    expect(exchanged.chain.narrowed).toBe('Scope narrowed 3 → 1');
    expect(user.chain).toBeUndefined();
  });

  it('reports a token the run did not issue as not present', () => {
    const [u, a, e] = pickTokenCards([events[0]]);
    expect([u.present, a.present, e.present]).toEqual([true, false, false]);
  });
});

describe('pickIntentToken', () => {
  it('reads the BFF intent token', () => {
    expect(pickIntentToken(events)).toMatchObject({ intent: 'get_loyalty_status', vertical: 'airlines', tools: 'get_loyalty_status', confidence: 0.7 });
  });
  it('is null when the run minted none, and clamps a bad confidence', () => {
    expect(pickIntentToken([])).toBeNull();
    expect(pickIntentToken([{ id: 'intent-token', claims: { intent: 'x', confidence: 7 } }]).confidence).toBe(1);
  });
});

describe('TokenCards', () => {
  it('cards variant: one card per token with claim rows, the relation strip and the intent token', () => {
    render(<TokenCards events={events} />);
    expect(screen.getByRole('group', { name: 'Tokens in this request' })).toBeTruthy();
    expect(screen.getAllByText('Exchanged token').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Decoded JWT/)).toHaveLength(1);
    expect(screen.getByText('6 claims hidden by policy'.replace('6', '2'))).toBeTruthy();
    expect(screen.getByText(/Scope narrowed 3 → 1/)).toBeTruthy();
    expect(screen.getByText(/minted by the BFF/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy claims' }).length).toBe(3);
  });

  it('rows variant: one expandable row per token, the user token open first', () => {
    const { container } = render(<TokenCards events={events} variant="rows" />);
    const rows = container.querySelectorAll('details.token-cards__card');
    expect(rows).toHaveLength(3);
    expect(rows[0].open).toBe(true);
    expect(rows[1].open).toBe(false);
    expect(within(rows[0]).getByText('Pat Rivera · pat@x.example')).toBeTruthy();
  });

  it('shows "expired" for a token past its expiry', () => {
    render(<TokenCards events={[{ id: 'user-token', claims: { sub: 'u', iat: t - 700, exp: t - 100 } }]} />);
    expect(screen.getByText('expired')).toBeTruthy();
  });

  it('says so when a token was not issued, instead of inventing claims', () => {
    render(<TokenCards events={[events[0]]} />);
    expect(screen.getAllByText('Not issued in this run')).toHaveLength(2);
  });

  it('renders nothing, and reports no cards, when the run issued none of them', () => {
    expect(hasTokenCards([])).toBe(false);
    expect(hasTokenCards([{ id: 'gw-authorize', status: 'permit' }])).toBe(false);
    expect(hasTokenCards(undefined)).toBe(false);
    expect(hasTokenCards([{ id: 'user-token' }])).toBe(false);
    expect(render(<TokenCards events={[]} />).container.firstChild).toBeNull();
  });

  it('an intent token alone still counts as something to show', () => {
    expect(hasTokenCards([events[3]])).toBe(true);
  });
});
