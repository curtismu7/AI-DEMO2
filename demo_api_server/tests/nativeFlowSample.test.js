// demo_api_server/tests/nativeFlowSample.test.js
//
// /api/native-flow-sample is a PUBLIC route that drives a real PingOne native
// flow. Two things about it are easy to break silently:
//
//   1. It echoes raw PingOne response bodies into the page so each step teaches
//      what came back. Those bodies carry tokens once the flow completes, and
//      the request bodies carry the test user's password and the one-time code.
//   2. The flow is split across two requests with state parked in memory, so a
//      stale or forged flow id must fail as a readable message, not a 500.
//
// These cover both without touching the network.
'use strict';

const express = require('express');
const request = require('supertest');

const routerModule = require('../routes/nativeFlowSample');
const { _scrub: scrub, _SAMPLES: SAMPLES, _OTP_PENDING: OTP_PENDING } = routerModule;

const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
const FAKE_JWT = `eyJhbGciOiJSUzI1NiIsImtpZCI6ImRlZmF1bHQifQ.${'a'.repeat(40)}.${'b'.repeat(40)}`;

function app() {
    const a = express();
    a.use('/api/native-flow-sample', routerModule);
    return a;
}

describe('nativeFlowSample response scrubbing', () => {
    it('removes tokens from a completed token response', () => {
        const raw = JSON.stringify({
            access_token: FAKE_JWT,
            id_token: FAKE_JWT,
            refresh_token: FAKE_JWT,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile',
        });
        expect(JWT_RE.test(raw)).toBe(true);

        const masked = scrub(raw);
        expect(JWT_RE.test(masked)).toBe(false);
        expect(masked).not.toContain(FAKE_JWT);
    });

    it('keeps the non-secret fields so the step card still teaches', () => {
        const parsed = JSON.parse(scrub(JSON.stringify({
            access_token: FAKE_JWT,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: 'openid profile',
        })));
        expect(parsed.token_type).toBe('Bearer');
        expect(parsed.expires_in).toBe(3600);
        expect(parsed.scope).toBe('openid profile');
        expect(parsed.access_token).toBe('<redacted>');
    });

    it('removes the credentials the flow legs carry', () => {
        const masked = scrub(JSON.stringify({
            username: 'sample-apps-test-user',
            password: 'a-real-password',
            otp: '123456',
            verificationCode: '654321',
        }));
        expect(masked).not.toContain('a-real-password');
        expect(masked).not.toContain('123456');
        expect(masked).not.toContain('654321');
        // The username is not a secret and identifies which account ran.
        expect(masked).toContain('sample-apps-test-user');
    });

    it('passes a non-JSON error body through unchanged', () => {
        const raw = 'invalid_client: Request denied';
        expect(scrub(raw)).toBe(raw);
    });
});

describe('nativeFlowSample request guards', () => {
    it('rejects an unknown sample before making any PingOne call', async () => {
        const res = await request(app())
            .post('/api/native-flow-sample/run')
            .send({ sample: 'not-a-sample' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('not-a-sample');
    });

    it('rejects a missing sample', async () => {
        const res = await request(app()).post('/api/native-flow-sample/run').send({});
        expect(res.status).toBe(400);
    });

    it('answers an unknown flow id with 410 and a readable step, not a 500', async () => {
        const res = await request(app())
            .post('/api/native-flow-sample/otp')
            .send({ flowId: 'no-such-flow', otp: '123456' });
        expect(res.status).toBe(410);
        expect(res.body.success).toBe(false);
        expect(res.body.steps[0].ok).toBe(false);
        expect(res.body.steps[0].title).toMatch(/expired/i);
    });

    it('requires an otp value', async () => {
        const res = await request(app())
            .post('/api/native-flow-sample/otp')
            .send({ flowId: 'no-such-flow' });
        // The flow lookup fails first; either way it must not be a 500.
        expect([400, 410]).toContain(res.status);
    });
});

describe('nativeFlowSample sample definitions', () => {
    it('uses the vendor content types the flow engine requires', () => {
        // application/json here returns 415 from PingOne, so these must stay
        // vendor types.
        for (const cfg of Object.values(SAMPLES)) {
            expect(cfg.submitType).toMatch(/^application\/vnd\.pingidentity\..+\+json$/);
            expect(cfg.otpType).toMatch(/^application\/vnd\.pingidentity\..+\+json$/);
        }
    });

    it('only user-registration is marked as creating an account', () => {
        expect(SAMPLES['user-registration'].creates).toBe(true);
        expect(SAMPLES['mfa-demo'].creates).toBe(false);
    });

    it('treats every code-sent status as a prompt, including registration', () => {
        // Dropping VERIFICATION_CODE_REQUIRED would make user-registration look
        // like an unexpected-status failure right after it created a user.
        expect(OTP_PENDING).toContain('VERIFICATION_CODE_REQUIRED');
        expect(OTP_PENDING).toContain('OTP_REQUIRED');
    });
});
