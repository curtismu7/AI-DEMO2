'use strict';
/**
 * utils/jwtDecoder is the canonical JWT decoder in this repo. 29 other files
 * hand-roll a `split('.')` + Buffer decode; the point of consolidating is that
 * one decoder can be tested and fixed once, not that the others produced wrong
 * output — Node's base64 decoder is lenient enough that they did not (pinned
 * below, so nobody "fixes" a bug that was never there).
 *
 * The defect this branch actually addresses is upstream of decoding: callers
 * were allowlisting claims after decode, so most of the token was silently
 * dropped before it ever reached a viewer.
 */
const {
    decodeBase64Url,
    parseJwtPayload,
    parseJwtHeader,
    getJwtClaim,
} = require('../../utils/jwtDecoder');

// Build a JWT whose header and payload both contain bytes that base64url encodes
// with '-' and '_' — the exact case plain 'base64' gets wrong.
function b64url(obj) {
    return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}
const HEADER = { alg: 'RS256', typ: 'JWT', kid: 'k-ÿþ' };
const PAYLOAD = {
    iss: 'https://auth.pingone.com/abc',
    sub: 'user-1',
    azp: 'client-abc',           // dropped by the old allowlist
    sid: 'session-xyz',          // dropped by the old allowlist
    amr: ['pwd', 'mfa'],         // dropped by the old allowlist
    'custom:tier': 'gold',       // dropped by the old allowlist
    weird: 'ÿþý', // forces '-'/'_' in the base64url encoding
};
const JWT = `${b64url(HEADER)}.${b64url(PAYLOAD)}.sig-not-checked`;

describe('jwtDecoder', () => {
    test('decodeBase64Url handles the URL alphabet and missing padding', () => {
        const raw = 'ÿþý ok';
        const encoded = Buffer.from(raw, 'utf8').toString('base64url');
        expect(encoded).toMatch(/[-_]/); // guard: this fixture must exercise the URL alphabet
        expect(decodeBase64Url(encoded)).toBe(raw);
    });

    test('parseJwtPayload returns every claim, including ones no allowlist knows', () => {
        const payload = parseJwtPayload(JWT);
        expect(payload).toEqual(PAYLOAD);
        // The four the old parseTokenContent allowlist silently dropped:
        expect(payload.azp).toBe('client-abc');
        expect(payload.sid).toBe('session-xyz');
        expect(payload.amr).toEqual(['pwd', 'mfa']);
        expect(payload['custom:tier']).toBe('gold');
    });

    test('parseJwtHeader decodes the header, base64url-correctly', () => {
        expect(parseJwtHeader(JWT)).toEqual(HEADER);
    });

    test('getJwtClaim reads a claim and falls back', () => {
        expect(getJwtClaim(JWT, 'sub')).toBe('user-1');
        expect(getJwtClaim(JWT, 'nope', 'fallback')).toBe('fallback');
    });

    test.each([
        ['not-a-jwt', 'Invalid JWT format'],
        ['only.two', 'Invalid JWT format'],
    ])('parseJwtHeader rejects %s', (bad, msg) => {
        expect(() => parseJwtHeader(bad)).toThrow(msg);
    });

    test('parseJwtHeader rejects a non-string', () => {
        expect(() => parseJwtHeader(null)).toThrow(TypeError);
    });

    test("Node's plain-'base64' decode happens to agree — the helper is for spec-correctness, not a live bug", () => {
        // Worth pinning explicitly, because it is easy to assume otherwise and
        // then "fix" a bug that was never there: Node's base64 decoder is
        // lenient. It accepts the URL alphabet ('-'/'_') and missing padding, so
        // the older `Buffer.from(part, 'base64')` spelling in routes/tokens.js
        // produced CORRECT claims. jwtDecoder is the single decoder because 29
        // files reimplementing one is the problem — not because output differed.
        const seg = JWT.split('.')[0];
        expect(Buffer.from(seg, 'base64').toString('utf8')).toBe(JSON.stringify(HEADER));
        expect(parseJwtHeader(JWT)).toEqual(HEADER);
    });
});
