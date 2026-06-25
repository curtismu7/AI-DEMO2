const { buildCustomEvent, buildTokenChainEvents } = require('../services/aguiSseProxy');

describe('buildCustomEvent', () => {
  test('returns AG-UI CUSTOM event shape', () => {
    const ev = buildCustomEvent('token_chain_bearer_obtained', { sub: 'u1', exp: 9999 });
    expect(ev).toEqual({
      type: 'CUSTOM',
      name: 'token_chain_bearer_obtained',
      value: { sub: 'u1', exp: 9999 },
    });
  });
});

describe('buildTokenChainEvents', () => {
  test('maps tokenEvents array to CUSTOM AG-UI events', () => {
    const tokenEvents = [
      { id: 'user-token', status: 'acquired', claims: { sub: 'u1', exp: 100 }, label: 'Bearer' },
      { id: 'exchange-in-progress', status: 'active', claims: {}, label: 'Exchange' },
      { id: 'exchanged-token', status: 'exchanged', claims: { act: { sub: 'client_x' }, exp: 200 }, label: 'MCP Token' },
    ];
    const events = buildTokenChainEvents(tokenEvents);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_bearer_obtained' });
    expect(events[1]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_exchange_started' });
    expect(events[2]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_mcp_token_obtained' });
  });
});
