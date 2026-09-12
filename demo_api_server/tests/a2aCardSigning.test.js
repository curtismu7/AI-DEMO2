'use strict';

const express = require('express');
const request = require('supertest');
const {
  getCardSigningKey,
  publicJwks,
  getSignedCard,
  cardVerifier,
} = require('../services/a2aCardSigningService');
const { createA2aProtocolRouter } = require('../services/a2aProtocolServer');

const CFG = { getEffective: (k) => (k === 'PUBLIC_APP_URL' ? 'https://api.ping.demo:3001' : '') };

describe('A2A Agent Card signing', () => {
  test('publishes one Ed25519 verification key whose kid matches the signature', async () => {
    const jwks = publicJwks();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA', use: 'sig' });
    expect(jwks.keys[0].kid).toBe(getCardSigningKey().kid);
  });

  test('signs a card and verifies it', async () => {
    const card = await getSignedCard('investment', CFG);
    expect(card.signatures.length).toBeGreaterThan(0);
    await expect(cardVerifier(CFG)(card)).resolves.toBeUndefined();
  });

  test('pins the jku to our own origin in the PROTECTED header', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    expect(header.alg).toBe('EdDSA');
    expect(header.kid).toBe(getCardSigningKey().kid);
    expect(header.jku).toBe('https://api.ping.demo:3001/a2a/specialists/.well-known/jwks.json');
  });

  test('rejects a tampered card', async () => {
    const card = await getSignedCard('investment', CFG);
    const tampered = { ...card, name: 'Attacker Agent' };
    await expect(cardVerifier(CFG)(tampered)).rejects.toThrow();
  });

  test('refuses a jku pointing at a foreign origin (key substitution / SSRF)', async () => {
    const card = await getSignedCard('investment', CFG);
    const header = JSON.parse(
      Buffer.from(card.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    const forged = {
      ...card,
      signatures: [
        {
          ...card.signatures[0],
          protected: Buffer.from(
            JSON.stringify({ ...header, jku: 'https://evil.example/jwks.json' }),
          ).toString('base64url'),
        },
      ],
    };
    // Re-encoding the protected header also invalidates the signature (the
    // signing input no longer matches), so the generic rejection below would
    // happen even WITHOUT the jku guard — it doesn't by itself prove the
    // guard ran. @a2a-js/sdk's verifyAgentCardSignature (dist/index.cjs)
    // tries each signature in a try/catch and only surfaces the per-entry
    // error via console.debug before always rejecting with the generic
    // message, so spy on that to prove cardVerifier's retrievePublicKey
    // callback actually threw its specific "refusing foreign jku" error
    // (i.e. refused synchronously, without ever fetching the foreign jku).
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});
    try {
      await expect(cardVerifier(CFG)(forged)).rejects.toThrow(
        'No valid signatures found on agent card.',
      );
      const sawJkuRefusal = debugSpy.mock.calls.some((args) =>
        args.some((arg) => arg instanceof Error && /refusing foreign jku/i.test(arg.message)),
      );
      expect(sawJkuRefusal).toBe(true);
    } finally {
      debugSpy.mockRestore();
    }
  });

  test('a PUBLIC_APP_URL change is not served from a stale cache keyed on vertical alone', async () => {
    const card1 = await getSignedCard('investment', CFG);
    const header1 = JSON.parse(
      Buffer.from(card1.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    expect(header1.jku).toBe('https://api.ping.demo:3001/a2a/specialists/.well-known/jwks.json');

    const otherCfg = {
      getEffective: (k) => (k === 'PUBLIC_APP_URL' ? 'https://other.ping.demo:9999' : ''),
    };
    const card2 = await getSignedCard('investment', otherCfg);
    const header2 = JSON.parse(
      Buffer.from(card2.signatures[0].protected, 'base64url').toString('utf-8'),
    );
    expect(header2.jku).toBe('https://other.ping.demo:9999/a2a/specialists/.well-known/jwks.json');
  });
});

describe('A2A card + JWKS routes (served by createA2aProtocolRouter)', () => {
  // Mounted at the same path server.js uses, since jwksUrl() hardcodes
  // /a2a/specialists/.well-known/jwks.json — mounting elsewhere would make
  // the jku resolve somewhere the test never actually serves it from.
  function buildApp(cfg) {
    const app = express();
    app.use('/a2a/specialists', createA2aProtocolRouter({ configStore: cfg }));
    return app;
  }

  test('GET /a2a/specialists/.well-known/jwks.json serves the verification key', async () => {
    const res = await request(buildApp(CFG)).get('/a2a/specialists/.well-known/jwks.json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(publicJwks());
  });

  test('GET /a2a/specialists/:vertical/.well-known/agent-card.json serves a signed, verifiable card', async () => {
    const res = await request(buildApp(CFG)).get(
      '/a2a/specialists/investment/.well-known/agent-card.json',
    );
    expect(res.status).toBe(200);
    expect(res.body.signatures.length).toBeGreaterThan(0);
    await expect(cardVerifier(CFG)(res.body)).resolves.toBeUndefined();
  });
});
