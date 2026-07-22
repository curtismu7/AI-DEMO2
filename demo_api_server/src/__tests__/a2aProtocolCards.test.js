'use strict';

/**
 * Unit tests for A2A Agent Cards + PingOne bearer middleware.
 */

const {
  buildSpecialistAgentCard,
  buildAllSpecialistAgentCards,
  specialistRpcUrl,
} = require('../../services/a2aAgentCardService');
const { A2A_SPECIALISTS } = require('../../config/a2aSpecialists');
const { requireA2aPingOneBearer } = require('../../middleware/a2aPingOneBearer');

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`;
}

describe('a2aAgentCardService', () => {
  test('builds a card for every specialist vertical', () => {
    const cards = buildAllSpecialistAgentCards({ getEffective: () => '' });
    expect(Object.keys(cards).sort()).toEqual(Object.keys(A2A_SPECIALISTS).sort());
    for (const [vertical, card] of Object.entries(cards)) {
      expect(card.name).toBe(A2A_SPECIALISTS[vertical].specialistName);
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
});

describe('requireA2aPingOneBearer', () => {
  function mockRes() {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    return res;
  }

  test('rejects missing Authorization', () => {
    const res = mockRes();
    requireA2aPingOneBearer({ headers: {} }, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  test('accepts PingOne-shaped Bearer JWT', () => {
    const res = mockRes();
    const req = {
      headers: { authorization: `Bearer ${fakeJwt({ client_id: 'agent-1', aud: ['x'] })}` },
    };
    let nextCalled = false;
    requireA2aPingOneBearer(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(req.a2aPingOne.clientId).toBe('agent-1');
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
