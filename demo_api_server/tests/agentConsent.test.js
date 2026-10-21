'use strict';
jest.mock('../services/configStore', () => ({
  getEffective: (k) => ({ ai_agent_client_id: 'agent-1', pf_token_exchange_client_id: 'pf-exchanger', ff_may_act_seed: global.__FF__ || 'false' }[k] || ''),
  getOAuthProvider: () => global.__PROVIDER__ || 'pingone',
}));
const mockFind = jest.fn();
jest.mock('../services/lmdb/delegationStore.lmdb', () => ({ findActiveByActorAndGrantor: (...a) => mockFind(...a) }));
const { consentSub } = require('../services/agentConsent');

const req = (extra = {}) => ({ user: { id: 'u1' }, session: { mayAct: { sub: 'agent-1' }, ...extra } });

describe('consentSub', () => {
  beforeEach(() => { global.__FF__ = 'false'; global.__PROVIDER__ = 'pingone'; mockFind.mockReset(); });
  test('active grant record -> agent id', () => {
    mockFind.mockReturnValue({ id: 'g' });
    expect(consentSub(req())).toBe('agent-1');
    expect(mockFind).toHaveBeenCalledWith('agent-1', 'u1');
  });
  test('no grant -> empty, even if the token carried may_act', () => {
    mockFind.mockReturnValue(null);
    expect(consentSub(req())).toBe('');
  });
  test('no session -> undefined (legacy callers)', () => {
    expect(consentSub({})).toBeUndefined();
  });
  test('ff_may_act_seed ON honors the session may_act', () => {
    global.__FF__ = 'true';
    mockFind.mockReturnValue(null);
    expect(consentSub(req())).toBe('agent-1');
  });
  test('PingFederate mode: the consented agent is the PF acting agent, not the PingOne AI Agent app', () => {
    global.__PROVIDER__ = 'pingfederate';
    mockFind.mockReturnValue({ id: 'g' });
    expect(consentSub(req())).toBe('pf-exchanger');
    expect(mockFind).toHaveBeenCalledWith('pf-exchanger', 'u1');
  });
});
