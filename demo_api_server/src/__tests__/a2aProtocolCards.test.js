'use strict';

/**
 * Unit tests for A2A Agent Cards + PingOne bearer middleware.
 */

const express = require('express');
const request = require('supertest');
const {
  buildSpecialistAgentCard,
  buildAllSpecialistAgentCards,
  specialistRpcUrl,
} = require('../../services/a2aAgentCardService');
const {
  specialistForVertical,
  verticalsWithSpecialist,
} = require('../../config/a2aSpecialists');
const { createA2aProtocolRouter } = require('../../services/a2aProtocolServer');
const { requireA2aPingOneBearer } = require('../../middleware/a2aPingOneBearer');

// requireA2aPingOneBearer now verifies the bearer's signature via
// services/tokenValidationService (JWKS-based, same helper middleware/auth.js
// uses) before trusting any claim. Mock it here so these unit/route tests can
// control the verification verdict without a live PingOne JWKS fetch.
jest.mock('../../services/tokenValidationService', () => ({
  validateToken: jest.fn(),
}));
const { validateToken } = require('../../services/tokenValidationService');

// The bearer gate's mount site (services/a2aProtocolServer.js) never threads a
// cfg into verifyA2aBearer, so it always falls back to the real configStore
// singleton. That store has no checked-in default for the generalist's client
// id (a credential, unlike the intermediate-audience URIs which DO have a
// real fallback in scope-topology.json), so without this mock every claim
// would fail the actor check regardless of shape. Only getEffective is read.
const GENERALIST_CLIENT_ID = 'generalist-agent';
jest.mock('../../services/configStore', () => ({
  getEffective: (key) => (key === 'pingone_ai_agent_client_id' ? 'generalist-agent' : ''),
}));

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('a2aAgentCardService', () => {
  test('builds a card for every specialist vertical', () => {
    const cards = buildAllSpecialistAgentCards({ getEffective: () => '' });
    expect(Object.keys(cards).sort()).toEqual(verticalsWithSpecialist().sort());
    for (const [vertical, card] of Object.entries(cards)) {
      expect(card.name).toBe(specialistForVertical(vertical).specialistName);
      expect(card.supportedInterfaces[0].protocolBinding).toBe('JSONRPC');
      expect(card.supportedInterfaces[0].protocolVersion).toBe('1.0');
      expect(card.securitySchemes.pingoneBearer).toBeTruthy();
      expect(card.skills.length).toBeGreaterThan(0);
      expect(card.documentationUrl).toContain('a2a-protocol.org');
    }
  });

  test('specialistRpcUrl includes vertical path', () => {
    expect(specialistRpcUrl('banking', { getEffective: () => 'https://api.ping.demo:3001' })).toBe(
      'https://api.ping.demo:3001/a2a/specialists/banking',
    );
  });

  test('unknown vertical returns null', () => {
    expect(buildSpecialistAgentCard('nope')).toBeNull();
  });

  test('routes A&F SendMessage through its aliased specialist handler', async () => {
    // abercrombie-fitch aliases to the 'retail' specialist (appKey 'purchase');
    // its intermediate audience has a real checked-in fallback in
    // scope-topology.json ("a2a-intermediate-purchase.ping.demo").
    const claims = {
      sub: 'user-af',
      aud: ['a2a-intermediate-purchase.ping.demo'],
      scope: 'agent:invoke:purchase',
      act: { client_id: GENERALIST_CLIENT_ID },
    };
    validateToken.mockResolvedValueOnce(claims);
    const cfg = {
      getEffective: (key) =>
        key === 'ff_a2a_delegation' ? true : 'https://api.ping.demo:3001',
    };
    const app = express();
    app.use(createA2aProtocolRouter({ configStore: cfg }));

    const res = await request(app)
      .post('/abercrombie-fitch')
      .set('Authorization', `Bearer ${fakeJwt(claims)}`)
      .set('A2A-Version', '1.0')
      .send({
        jsonrpc: '2.0',
        id: 'anf-send-message',
        method: 'SendMessage',
        params: {
          message: {
            messageId: 'anf-message-1',
            role: 'ROLE_USER',
            parts: [{ text: 'Retrieve my A&F purchase history' }],
          },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    // The reply is DATA now, not an acknowledgment: one text part carrying
    // { result, toolError }. This caller names no skill in the message
    // metadata, so the specialist refuses before minting anything — the
    // specialist's identity is asserted via the metadata below.
    expect(JSON.parse(res.body.result.message.parts[0].text)).toEqual({
      result: null,
      toolError: 'not_authorized_for_skill',
    });
    expect(res.body.result.message.metadata).toMatchObject({
      vertical: 'abercrombie-fitch',
      specialistAppKey: specialistForVertical('abercrombie-fitch').appKey,
      specialist: specialistForVertical('abercrombie-fitch').specialistName,
      demoLayer: 'a2a-protocol-wire',
    });
  });

  test('ff_verified_trust_a2a off (or no cfg): only pingoneBearer is advertised', () => {
    const card = buildSpecialistAgentCard('banking', { getEffective: () => '' });
    expect(card.securitySchemes.pingoneBearer).toBeTruthy();
    expect(card.securitySchemes.verifiedTrustCredential).toBeUndefined();
    expect(Object.keys(card.securitySchemes)).toEqual(['pingoneBearer']);

    const cardNoCfg = buildSpecialistAgentCard('banking');
    expect(cardNoCfg.securitySchemes.verifiedTrustCredential).toBeUndefined();
  });

  test('ff_verified_trust_a2a on: verifiedTrustCredential scheme added, pingoneBearer stays the only REQUIRED scheme', () => {
    const cfg = { getEffective: (k) => (k === 'ff_verified_trust_a2a' ? 'true' : '') };
    const card = buildSpecialistAgentCard('banking', cfg);

    expect(card.securitySchemes.pingoneBearer).toBeTruthy();
    expect(card.securitySchemes.verifiedTrustCredential).toBeTruthy();
    expect(card.securitySchemes.verifiedTrustCredential.scheme.value.scheme).toBe('VC-SD-JWT');
    // Additive only — the VC is never a hard requirement, bearer still is.
    expect(card.securityRequirements).toEqual([{ schemes: { pingoneBearer: { list: [] } } }]);
  });
});

describe('requireA2aPingOneBearer', () => {
  function mockRes() {
    const res = {
      statusCode: 200,
      body: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
      set(header, value) {
        this.headers[header] = value;
        return this;
      },
    };
    return res;
  }

  beforeEach(() => {
    validateToken.mockReset();
  });

  test('rejects missing Authorization', async () => {
    const res = mockRes();
    await requireA2aPingOneBearer('investment')({ headers: {} }, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
    expect(validateToken).not.toHaveBeenCalled();
  });

  test('accepts a bearer that passes JWKS signature verification', async () => {
    // 'investment' is a real specialist (config/a2aSpecialists.js) with appKey
    // 'holdings' — its intermediate audience has a real checked-in fallback in
    // scope-topology.json ("a2a-intermediate-holdings.ping.demo").
    const claims = {
      sub: 'user-1',
      aud: ['a2a-intermediate-holdings.ping.demo'],
      scope: 'agent:invoke:holdings',
      act: { client_id: GENERALIST_CLIENT_ID },
    };
    validateToken.mockResolvedValueOnce(claims);
    const res = mockRes();
    const req = {
      headers: { authorization: `Bearer ${fakeJwt(claims)}` },
    };
    let nextCalled = false;
    await requireA2aPingOneBearer('investment')(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.a2aPingOne.clientId).toBe(GENERALIST_CLIENT_ID);
  });

  // Regression for the forged-identity bug: a JWT-shaped token whose signature
  // is garbage (or simply not signed by PingOne) must be REJECTED even though
  // it decodes cleanly and carries an attacker-chosen client_id. Before the
  // fix, decodeJwt() never checked the signature, so this exact request was
  // accepted and req.a2aPingOne.clientId was trusted as-is.
  test('rejects a forged/unsigned JWT with a garbage signature', async () => {
    validateToken.mockRejectedValueOnce(new Error('invalid signature'));
    const res = mockRes();
    const req = {
      headers: {
        authorization: `Bearer ${fakeJwt({ client_id: 'attacker-controlled-identity' })}`,
      },
    };
    let nextCalled = false;
    await requireA2aPingOneBearer('investment')(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.headers['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
    expect(req.a2aPingOne).toBeUndefined();
  });
});

describe('pushAgentCardEvent', () => {
  const { pushAgentCardEvent, buildSpecialistAgentCard } = require('../../services/a2aAgentCardService');
  const { buildA2aEvent } = require('../../services/a2aDelegationService');

  test('emits a2a-agent-card with skills and cardUrl', () => {
    const cfg = { getEffective: () => 'https://api.ping.demo:3001' };
    const card = buildSpecialistAgentCard('banking', cfg);
    const events = [];
    pushAgentCardEvent(buildA2aEvent, events, card, 'banking', cfg, 'in-process');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('a2a-agent-card');
    expect(events[0].agentName).toBe('Investment Advisor');
    expect(events[0].cardUrl).toContain('/a2a/specialists/banking/.well-known/agent-card.json');
    expect(events[0].skills.length).toBeGreaterThan(0);
    expect(events[0].protocolBinding).toBe('JSONRPC');
  });
});
