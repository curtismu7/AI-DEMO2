// demo_api_server/tests/m2mSampleRedaction.test.js
//
// /api/m2m-sample is a PUBLIC route that performs a client_credentials grant
// against the demo's PingOne environment. The upstream sample it is ported from
// prints the token response verbatim, which is safe on localhost but would hand
// a live management-API credential to any visitor here. These tests pin the
// redaction so a future edit cannot quietly restore the raw token.
'use strict';

const { _maskTokenResponse: mask } = require('../routes/m2mSample');

// A usable PingOne access token is a 3-part JWT beginning with eyJ.
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;

const FAKE_JWT = `eyJhbGciOiJSUzI1NiIsImtpZCI6ImRlZmF1bHQifQ.${'a'.repeat(40)}.${'b'.repeat(40)}`;

describe('m2mSample token redaction', () => {
    it('removes a usable access_token from the token response', () => {
        const raw = JSON.stringify({
            access_token: FAKE_JWT,
            token_type: 'Bearer',
            expires_in: 3600,
        });

        expect(JWT_RE.test(raw)).toBe(true);

        const masked = mask(raw);
        expect(JWT_RE.test(masked)).toBe(false);
        expect(masked).not.toContain(FAKE_JWT);
    });

    it('keeps the non-secret fields so the step card still teaches', () => {
        const masked = mask(JSON.stringify({
            access_token: FAKE_JWT,
            token_type: 'Bearer',
            expires_in: 3600,
        }));
        const parsed = JSON.parse(masked);

        expect(parsed.token_type).toBe('Bearer');
        expect(parsed.expires_in).toBe(3600);
        expect(parsed.access_token).toContain('redacted');
        expect(parsed.access_token).toContain(String(FAKE_JWT.length));
    });

    it('redacts id_token and refresh_token too', () => {
        const masked = mask(JSON.stringify({
            access_token: FAKE_JWT,
            id_token: FAKE_JWT,
            refresh_token: FAKE_JWT,
        }));
        expect(JWT_RE.test(masked)).toBe(false);
    });

    it('passes non-JSON error bodies through unchanged', () => {
        const raw = 'invalid_client: Request denied';
        expect(mask(raw)).toBe(raw);
    });

    it('leaves a JSON error response intact', () => {
        const raw = JSON.stringify({
            error: 'invalid_client',
            error_description: 'Request denied: Invalid client credentials',
        });
        expect(JSON.parse(mask(raw)).error).toBe('invalid_client');
    });
});
