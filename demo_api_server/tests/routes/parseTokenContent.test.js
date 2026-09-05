'use strict';
/**
 * parseTokenContent is what every token-chain hop is rendered from, so it
 * decides two things that matter:
 *
 *   1. how much of a token a user can actually see. It used to allowlist 15
 *      claims, so azp / sid / amr / acr / nonce / cnf and every PingOne custom
 *      claim were dropped with no indication they had existed — the viewer
 *      looked complete while hiding most of the token.
 *   2. that the SIGNATURE never leaves the server. The demo's headline property
 *      is that the browser never holds a raw OAuth token (docs/api-spec.yaml,
 *      "token custody"); returning the third segment would hand the browser a
 *      replayable credential and quietly break exactly what the demo teaches.
 *
 * The second is the load-bearing assertion here.
 */
const { parseTokenContent } = require('../../routes/tokens');

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

const HEADER = { alg: 'RS256', typ: 'JWT', kid: 'key-1' };
const PAYLOAD = {
    iss: 'https://auth.pingone.com/abc',
    sub: 'user-1',
    aud: 'mcpgateway.ping.demo',
    exp: 1893456000,
    iat: 1893452400,
    scope: 'read write',
    client_id: 'client-abc',
    act: { sub: 'agent-1' },
    // None of these survived the old allowlist:
    azp: 'client-abc',
    sid: 'sess-xyz',
    amr: ['pwd', 'mfa'],
    acr: 'urn:ping:loa:2',
    nonce: 'n-123',
    'p1:tier': 'gold',
};
const SIGNATURE = 'ZmFrZS1zaWduYXR1cmUtdmFsdWU';
const JWT = `${b64url(HEADER)}.${b64url(PAYLOAD)}.${SIGNATURE}`;

describe('parseTokenContent', () => {
    test('never returns the raw signature, in any field', async () => {
        const out = await parseTokenContent(JWT);
        expect(out.signature).toBe('present');
        // Belt and braces: the signature must not appear ANYWHERE in the
        // serialised result, not merely be absent from the field we remembered.
        expect(JSON.stringify(out)).not.toContain(SIGNATURE);
    });

    test('never returns the raw JWT itself', async () => {
        const out = await parseTokenContent(JWT);
        expect(JSON.stringify(out)).not.toContain(JWT);
    });

    test('returns the FULL payload, including claims no allowlist anticipated', async () => {
        const out = await parseTokenContent(JWT);
        expect(out.payload).toEqual(PAYLOAD);
        for (const claim of ['azp', 'sid', 'amr', 'acr', 'nonce', 'p1:tier']) {
            expect(out.payload).toHaveProperty(claim);
        }
    });

    test('still returns every claim the previous shape did', async () => {
        // Additive, not a rewrite: existing readers of these keys keep working.
        const out = await parseTokenContent(JWT);
        for (const claim of ['iss', 'sub', 'aud', 'exp', 'iat', 'scope', 'client_id', 'act']) {
            expect(out.payload[claim]).toEqual(PAYLOAD[claim]);
        }
    });

    test('returns the full header', async () => {
        const out = await parseTokenContent(JWT);
        expect(out.header).toEqual(HEADER);
    });

    test('derives expiry and issue timestamps', async () => {
        const out = await parseTokenContent(JWT);
        expect(out.type).toBe('JWT');
        expect(out.expires_at).toBe(new Date(PAYLOAD.exp * 1000).toISOString());
        expect(out.issued_at).toBe(new Date(PAYLOAD.iat * 1000).toISOString());
    });

    test('returns null for an absent token rather than throwing', async () => {
        expect(await parseTokenContent(null)).toBeNull();
        expect(await parseTokenContent(undefined)).toBeNull();
    });

    test('a malformed JWT does not throw out of the chain builder', async () => {
        // Every hop calls this; one unparseable token must not 500 the whole
        // chain and blank the panel.
        await expect(parseTokenContent('not.a.jwt')).resolves.toBeDefined();
    });
});
