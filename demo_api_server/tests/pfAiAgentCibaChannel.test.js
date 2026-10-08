'use strict';

// The Protocol Playground's canned CIBA-PF steps execute a fixed endpoint from
// protocolFlows.json, so the BFF owns the channel choice: POST /ciba/decision
// dispatches to the mock phone or the web approver, whichever is live. These
// tests pin that dispatcher plus the invariant that the shipped flow's canned
// bodies pass the BFF's own validation (step 1 shipped "Approve $500 transfer"
// and 400'd every run against BINDING_MESSAGE).

const fs = require('fs');
const path = require('path');

const { decideCiba } = require('../services/pfAiAgentCibaService');

jest.mock('../services/pfAiAgentCibaWebApproverService', () => ({
  isEnabled: jest.fn(() => false),
  decide: jest.fn(() => ({ ok: true })),
  register: jest.fn(),
  lookup: jest.fn(),
  _requests: new Map(),
}));

const cibaWebApprover = require('../services/pfAiAgentCibaWebApproverService');

const storeWith = (flags = {}) => ({
  getEffective: (key) => String(flags[String(key).toLowerCase()] ?? ''),
});
// Mock-phone store: only the mock flag on, so mockEnabled() is true and webApproverOn() false.
const mockStore = () => storeWith({ pf_ai_ciba_mock_enabled: 'true' });

const signedIn = () => ({
  session: {
    user: { username: 'demouser' },
    pfAiAgent: { cibaPending: { mock: true, loginHint: 'demouser', expiresAt: Date.now() + 60000 } },
  },
  body: { decision: 'approve' },
});

describe('decideCiba — channel-agnostic approval endpoint', () => {
  afterEach(() => jest.clearAllMocks());

  it('routes to the mock phone when the web approver is off', () => {
    const req = signedIn();
    const out = decideCiba(req, { store: mockStore(), now: () => Date.now() });
    expect(out).toMatchObject({ state: 'approved' });
    expect(cibaWebApprover.decide).not.toHaveBeenCalled();
  });

  it('routes to the web approver when it is enabled', () => {
    cibaWebApprover.isEnabled.mockReturnValue(true);
    const req = signedIn();
    req.session.pfAiAgent.cibaPending = { loginHint: 'demouser', expiresAt: Date.now() + 60000 };
    const out = decideCiba(req, { store: mockStore(), now: () => Date.now() });
    expect(out).toEqual({ ok: true });
    expect(cibaWebApprover.decide).toHaveBeenCalledWith(req, 'approve', expect.anything());
  });

  it('rejects an invalid decision like the mock phone does', () => {
    cibaWebApprover.isEnabled.mockReturnValue(false);
    const req = signedIn();
    req.body = { decision: 'maybe' };
    expect(() => decideCiba(req, { store: mockStore(), now: () => Date.now() })).toThrow(/approve or deny/);
  });
});

describe('shipped protocolFlows.json stays valid against the BFF', () => {
  const flows = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../demo_api_ui/src/data/protocolFlows.json'), 'utf8'),
  );
  // Mirrors BINDING_MESSAGE in services/pfAiAgentCibaService.js. If the BFF's
  // rule tightens, this test fails and the shipped default body must follow.
  const BINDING_MESSAGE = /^[A-Za-z0-9._+/!?#-]{1,20}$/;

  it('every CIBA flow ships a bindingMessage the BFF accepts', () => {
    const cibaFlows = Object.values(flows).filter((f) => f.id?.startsWith('ciba'));
    expect(cibaFlows.length).toBeGreaterThan(0);
    for (const flow of cibaFlows) {
      for (const step of flow.steps || []) {
        const msg = step.body?.bindingMessage;
        if (msg !== undefined) {
          expect({ flow: flow.id, bindingMessage: msg, valid: BINDING_MESSAGE.test(String(msg).trim()) })
            .toEqual({ flow: flow.id, bindingMessage: msg, valid: true });
        }
      }
    }
  });

  it('the Playground CIBA-PF step 2 posts to the channel-agnostic decision endpoint', () => {
    const flow = flows['ciba-hitl-pf'];
    const step2 = (flow.steps || []).find((s) => s.id === 'step-2');
    expect(step2.endpoint).toBe('/api/pf-ai-agent/ciba/decision');
  });
});
