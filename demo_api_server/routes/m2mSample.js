// M2M Client Credentials sample — server-side workflow runner.
//
// Port of ping-rocks/devdocs-sample-apps m2m-credentials, wired to this demo's
// PingOne worker app (PINGONE_BOOTSTRAP_*). The workflow is entirely
// server-side: the client secret never reaches the browser. The route returns
// the same step objects the original sample renders as cards, so the page can
// reproduce the sample's UI verbatim.
//
// Steps (matching the sample):
//   1.  Build token request     — assemble URL and HTTP Basic credentials.
//   2.  Call /as/token          — POST grant_type=client_credentials.
//   3.  Decode access token     — split the JWT, decode header + payload.
//   4.  Fetch JWKS              — retrieve PingOne's public signing keys.
//   5.  Verify signature        — validate the JWT signature (RS256).
//   6.  Validate claims         — check iss, client_id, exp, iat.
//   7a. Risk evaluation (A)     — caller IP, type=EXTERNAL  -> LOW/MEDIUM.
//   8a. Management API call (A) — proceeds because risk is not HIGH.
//   7b. Risk evaluation (B)     — Tor IP, bot UA            -> HIGH.
//   8b. Management API call (B) — blocked because risk is HIGH.

const express = require('express');
const crypto = require('crypto');

const router = express.Router();

const REGION_TLD = { com: 'com', eu: 'eu', ca: 'ca', asia: 'asia', 'com.au': 'com.au' };

function pingoneHosts() {
    const regionKey = process.env.PINGONE_REGION || process.env.PINGONE_BOOTSTRAP_REGION;
    const region = REGION_TLD[regionKey] || 'com';
    return {
        authPath: `https://auth.pingone.${region}`,
        apiPath: `https://api.pingone.${region}`,
    };
}

// Prefer PINGONE_WORKER_* — the names the upstream sample itself uses, and the
// ones the BFF container already has. PINGONE_BOOTSTRAP_* is the fallback: it
// carries the same worker app but is only present in the repo-root .env, which
// the demo-api-server container does not read.
function creds() {
    return {
        envID: process.env.PINGONE_ENVIRONMENT_ID
            || process.env.PINGONE_WORKER_ENV_ID
            || process.env.PINGONE_BOOTSTRAP_ENV_ID
            || '',
        clientID: process.env.PINGONE_WORKER_CLIENT_ID
            || process.env.PINGONE_BOOTSTRAP_CLIENT_ID
            || '',
        clientSecret: process.env.PINGONE_WORKER_CLIENT_SECRET
            || process.env.PINGONE_BOOTSTRAP_CLIENT_SECRET
            || '',
        ...pingoneHosts(),
    };
}

// --- helpers (mirrored from the sample) ---

function pretty(rawText) {
    try { return JSON.stringify(JSON.parse(rawText), null, 2); } catch (_) { return rawText; }
}

function prettyAny(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
}

// Mask the raw access_token before it is sent to the browser.
//
// The upstream sample prints the token response verbatim — safe there, because
// it runs on localhost against the developer's own tenant. This page is public
// and this deployment is internet-reachable, so returning the raw JWT would
// hand any visitor a working management-API credential for the environment.
// The decoded header and payload are still shown in full in step 3, so the
// teaching value is unchanged; only the usable credential is withheld.
function maskTokenResponse(rawText) {
    let parsed;
    try { parsed = JSON.parse(rawText); } catch (_) { return rawText; }
    if (!parsed || typeof parsed !== 'object') return rawText;
    for (const key of ['access_token', 'id_token', 'refresh_token']) {
        if (typeof parsed[key] === 'string') {
            parsed[key] = `<redacted — ${parsed[key].length} chars; decoded claims shown in step 3>`;
        }
    }
    return JSON.stringify(parsed, null, 2);
}

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Returns the IP of the request initiator, for the Protect event.ip field.
function callerIP(req) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
        const first = String(xff).split(',')[0].trim();
        if (first) return first;
    }
    let addr = (req.socket && req.socket.remoteAddress) || '';
    if (addr.startsWith('::ffff:')) addr = addr.slice(7);
    if (addr === '::1' || addr === '') return '127.0.0.1';
    return addr;
}

// decodeJWT splits a JWT and decodes header + payload. Does NOT verify.
function decodeJWT(token) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error(`Not a 3-part JWT: ${parts.length} parts`);
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, payload, parts };
}

// verifyJWS verifies the RS256 signature against PingOne's JWKS.
//
// The sample hand-rolls the JWK->PEM DER encoding to show the structure. Node's
// crypto.createPublicKey accepts a JWK directly, so we use that instead — same
// verification, without reimplementing SubjectPublicKeyInfo.
function verifyJWS(token, header, jwks) {
    if (header.alg !== 'RS256') {
        throw new Error(`Unsupported alg "${header.alg}" (this sample verifies RS256 only)`);
    }
    const keys = (jwks && jwks.keys) || [];
    const match = keys.find((k) => k.kid === header.kid);
    if (!match) throw new Error(`No JWK with kid="${header.kid}"`);

    const key = crypto.createPublicKey({ key: match, format: 'jwk' });
    const parts = String(token).split('.');
    const verify = crypto.createVerify('SHA256');
    verify.update(`${parts[0]}.${parts[1]}`);
    if (!verify.verify(key, Buffer.from(parts[2], 'base64url'))) {
        throw new Error('Signature verification failed');
    }
}

// PingOne Worker tokens carry client_id, not sub — there is no user subject.
function validateAccessClaims(payload, expectedIssuer, expectedClientID) {
    const errs = {};
    if (payload.iss !== expectedIssuer) {
        errs.iss = `got "${payload.iss}", want "${expectedIssuer}"`;
    }
    if (payload.client_id !== expectedClientID) {
        errs.client_id = `got "${payload.client_id}", want "${expectedClientID}"`;
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number') {
        if (payload.exp < nowSec) errs.exp = `expired (exp=${payload.exp}, now=${nowSec})`;
    } else {
        errs.exp = 'missing or non-numeric';
    }
    if (typeof payload.iat === 'number' && payload.iat > nowSec + 60) {
        errs.iat = `in the future (iat=${payload.iat}, now=${nowSec})`;
    }
    return errs;
}

function renderClaimChecks(errs) {
    if (Object.keys(errs).length === 0) {
        return '<span class="m2m-ok-text">All claims valid.</span>';
    }
    const items = Object.entries(errs)
        .map(([k, v]) => `<li><code>${escapeHTML(k)}</code>: ${escapeHTML(v)}</li>`)
        .join('');
    return `<ul class="m2m-err-text">${items}</ul>`;
}

function extractRiskResult(parsed) {
    const res = parsed && parsed.result;
    if (!res) return { level: 'n/a', score: 'n/a' };
    const level = (typeof res.level === 'string' && res.level) ? res.level : 'n/a';
    const score = (typeof res.score === 'number') ? String(res.score)
        : (typeof res.score === 'string' && res.score) ? res.score : 'n/a';
    return { level, score };
}

// Resolve a risk policy set without creating one: prefer the environment's
// default, else the first available. Returns null when Protect is unavailable.
async function resolveRiskPolicySet(accessToken, apiPath, envID) {
    try {
        const resp = await fetch(`${apiPath}/v1/environments/${envID}/riskPolicySets`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) return null;
        const body = await resp.json();
        const sets = (body._embedded && body._embedded.riskPolicySets) || [];
        if (sets.length === 0) return null;
        const chosen = sets.find((s) => s.default) || sets[0];
        return { id: chosen.id, name: chosen.name };
    } catch (_) {
        return null;
    }
}

async function getAccessToken({ authPath, envID, clientID, clientSecret }) {
    const tokenURL = `${authPath}/${envID}/as/token`;
    const basic = Buffer.from(`${clientID}:${clientSecret}`).toString('base64');
    const resp = await fetch(tokenURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials',
    });
    const raw = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { /* non-JSON error body */ }
    return { status: resp.status, raw, parsed, ok: resp.status < 400, tokenURL };
}

// --- risk + gate (steps 7x / 8x) ---

async function runRiskAndGate(accessToken, riskURL, mgmtURL, riskBody, riskStep, mgmtStep) {
    const steps = [];

    let riskStatus = 0; let riskRaw = ''; let riskParsed = null; let riskOK = false;
    try {
        const resp = await fetch(riskURL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(riskBody),
        });
        riskStatus = resp.status;
        riskRaw = await resp.text();
        try { riskParsed = JSON.parse(riskRaw); } catch (_) { /* non-JSON */ }
        riskOK = riskStatus < 400;
    } catch (err) {
        riskRaw = err.message;
    }

    const { level, score } = extractRiskResult(riskParsed);
    const eventIP = (riskBody.event && riskBody.event.ip) || '';
    const userType = (riskBody.event && riskBody.event.user && riskBody.event.user.type) || '';

    let riskDetail;
    if (riskStep === '7b') {
        riskDetail = '<strong>This evaluation is intentionally constructed to trigger a HIGH risk score.</strong><br><br>'
            + `The IP <code>${escapeHTML(eventIP)}</code> is a known Tor exit node. Tor is an anonymizing network commonly associated with `
            + 'attempts to obscure origin and bypass geo-controls. PingOne Protect\'s <strong>Anonymous Network Detection</strong> '
            + 'predictor recognizes this IP and scores it above the policy set\'s HIGH threshold, '
            + 'causing the overall evaluation to return HIGH.<br><br>'
            + 'A bot-like user agent is supplied to further reflect what a real suspicious M2M caller '
            + 'might look like. In production you would populate these fields from the actual upstream '
            + 'caller rather than hardcoding them.<br><br>'
            + 'SDK signals are omitted — there is no browser SDK in an M2M flow.<br>'
            + `HTTP ${riskStatus} &middot; level: <code>${escapeHTML(level)}</code> &middot; score: <code>${escapeHTML(score)}</code>`;
    } else {
        riskDetail = `Event: ip=<code>${escapeHTML(eventIP)}</code>, user.type=<code>${escapeHTML(userType)}</code>.<br>`
            + 'PingOne Protect scores the event against the configured risk policy set and returns a risk level (LOW / MEDIUM / HIGH) plus per-predictor details.<br>'
            + 'SDK signals are intentionally omitted — there is no browser SDK in an M2M flow.<br>'
            + `HTTP ${riskStatus} &middot; level: <code>${escapeHTML(level)}</code> &middot; score: <code>${escapeHTML(score)}</code>`;
    }

    steps.push({
        title: `${riskStep}. PingOne Protect risk evaluation`,
        ok: riskOK,
        url: `POST ${riskURL}`,
        detail: riskDetail,
        rawDetail: true,
        body: `request:\n${prettyAny(riskBody)}\n\nresponse:\n${pretty(riskRaw)}`,
    });

    if (!riskOK) {
        steps.push({
            title: `${mgmtStep}. Call PingOne Management API`,
            ok: false,
            url: `GET ${mgmtURL}`,
            detail: 'Skipped — the risk evaluation step did not succeed.',
        });
        return { level, score, steps };
    }

    if (level.toUpperCase() === 'HIGH') {
        steps.push({
            title: `${mgmtStep}. Call PingOne Management API`,
            ok: false,
            url: `GET ${mgmtURL}`,
            detail: `<strong>Blocked.</strong> PingOne Protect returned risk level <code>${escapeHTML(level)}</code> (score: <code>${escapeHTML(score)}</code>). `
                + 'Anonymous Network Detection flagged the IP as a known Tor exit node. '
                + 'The downstream management API call was <strong>not</strong> made.',
            rawDetail: true,
        });
        return { level, score, steps };
    }

    let mgmtStatus = 0; let mgmtRaw = ''; let mgmtOK = false;
    try {
        const resp = await fetch(mgmtURL, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        mgmtStatus = resp.status;
        mgmtRaw = await resp.text();
        mgmtOK = mgmtStatus < 400;
    } catch (err) {
        mgmtRaw = err.message;
    }

    steps.push({
        title: `${mgmtStep}. Call PingOne Management API`,
        ok: mgmtOK,
        url: `GET ${mgmtURL}`,
        detail: `Risk level <code>${escapeHTML(level)}</code> — proceeding. The access token is sent as a Bearer token.<br>HTTP ${mgmtStatus}`,
        rawDetail: true,
        body: pretty(mgmtRaw),
    });

    return { level, score, steps };
}

// --- workflow ---

async function runWorkflow(req, useProtect) {
    const { envID, clientID, clientSecret, authPath, apiPath } = creds();
    const steps = [];

    if (!envID || !clientID || !clientSecret) {
        return {
            success: false,
            steps: [{
                title: 'Configuration missing',
                ok: false,
                detail: 'The API server needs a PingOne worker app: PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID and PINGONE_WORKER_CLIENT_SECRET (PINGONE_BOOTSTRAP_* is accepted as a fallback).',
            }],
        };
    }

    // Step 1 — assemble the token request.
    const tokenURL = `${authPath}/${envID}/as/token`;
    steps.push({
        title: '1. Build token request',
        ok: true,
        url: `POST ${tokenURL}`,
        detail: 'The client_credentials grant requires no user interaction. The only inputs are the client\'s own credentials.<br><br>'
            + 'Headers:<br>&nbsp;&nbsp;<code>Authorization: Basic base64(client_id:client_secret)</code><br>&nbsp;&nbsp;<code>Content-Type: application/x-www-form-urlencoded</code><br>'
            + 'Form body:<br>&nbsp;&nbsp;<code>grant_type=client_credentials</code>',
        rawDetail: true,
        body: `client_id:     ${clientID}\ngrant_type:    client_credentials`,
    });

    // Step 2 — call the token endpoint.
    const tok = await getAccessToken({ authPath, envID, clientID, clientSecret });
    steps.push({
        title: '2. Token endpoint response',
        ok: tok.ok,
        url: `POST ${tokenURL}`,
        detail: 'PingOne validates the client credentials and, if valid, returns an access token. No authorization code or redirect is involved — this is the entire grant in one round trip.<br>'
            + `HTTP ${tok.status}`
            + '<br><em>The raw token value is redacted below because this page is publicly reachable; the decoded claims appear in step 3.</em>',
        rawDetail: true,
        body: maskTokenResponse(tok.raw),
    });
    if (!tok.ok) return { success: false, steps };

    const accessToken = tok.parsed && tok.parsed.access_token;

    // Step 3 — decode without verifying.
    let header = null; let payload = null; let decodeErr = null;
    try {
        const decoded = decodeJWT(accessToken);
        header = decoded.header;
        payload = decoded.payload;
    } catch (err) {
        decodeErr = err;
    }
    steps.push({
        title: '3. Decode access token',
        ok: decodeErr === null,
        detail: 'The access token is a JWT. Decoding it (without yet verifying the signature) shows the claims PingOne embedded — notably <code>client_id</code> (the client identity for M2M tokens), <code>iss</code>, <code>exp</code>, and any scopes granted by the authorization server.',
        rawDetail: true,
        body: decodeErr
            ? `Error: ${decodeErr.message}`
            : `header:\n${prettyAny(header)}\n\npayload:\n${prettyAny(payload)}`,
    });

    // Step 4 — fetch the JWKS.
    const jwksURL = `${authPath}/${envID}/as/jwks`;
    let jwksRaw = ''; let jwksParsed = null; let jwksOK = false;
    try {
        const resp = await fetch(jwksURL);
        jwksRaw = await resp.text();
        try { jwksParsed = JSON.parse(jwksRaw); } catch (_) { /* non-JSON */ }
        jwksOK = resp.status < 400;
    } catch (err) {
        jwksRaw = err.message;
    }
    steps.push({
        title: '4. Fetch JWKS',
        ok: jwksOK,
        url: `GET ${jwksURL}`,
        detail: 'Public keys used to verify the access token signature. In production, cache this response and re-fetch only when a new <code>kid</code> is encountered.',
        rawDetail: true,
        body: pretty(jwksRaw),
        collapsed: true,
    });

    // Step 5 — verify the signature.
    let verifyErr = null;
    if (decodeErr === null && jwksOK) {
        try { verifyJWS(accessToken, header, jwksParsed); } catch (err) { verifyErr = err; }
    } else if (decodeErr !== null) {
        verifyErr = new Error('Cannot verify — JWT decode failed');
    } else {
        verifyErr = new Error('Cannot verify — JWKS fetch failed');
    }
    steps.push({
        title: '5. Verify access token signature',
        ok: verifyErr === null,
        detail: `alg: <code>${header ? escapeHTML(String(header.alg || '')) : 'n/a'}</code>, `
            + `kid: <code>${header ? escapeHTML(String(header.kid || '')) : 'n/a'}</code><br>`
            + (verifyErr === null
                ? 'Signature valid (RS256, key matched by <code>kid</code>).'
                : `Signature INVALID: ${escapeHTML(verifyErr.message)}`),
        rawDetail: true,
    });

    // Step 6 — validate the claims.
    const expectedIssuer = `${authPath}/${envID}/as`;
    const claimsErrs = payload
        ? validateAccessClaims(payload, expectedIssuer, clientID)
        : { decode: 'JWT decode failed — cannot validate claims' };
    steps.push({
        title: '6. Validate access token claims',
        ok: Object.keys(claimsErrs).length === 0,
        detail: `Required checks: <code>iss</code> matches <code>${escapeHTML(expectedIssuer)}</code>, <code>client_id</code> matches <code>${escapeHTML(clientID)}</code>, <code>exp</code> &gt; now, <code>iat</code> not in the future.<br>`
            + 'Note: PingOne Worker app tokens use <code>client_id</code> (not <code>sub</code>) to identify the client. There is no <code>nonce</code> — no user authentication was involved.<br>'
            + renderClaimChecks(claimsErrs),
        rawDetail: true,
        body: payload ? prettyAny(payload) : '',
    });

    const mgmtURL = `${apiPath}/v1/environments/${envID}/users`;

    if (!useProtect) {
        // Basic path — straight to the management API, no risk evaluation.
        let mgmtStatus = 0; let mgmtRaw = ''; let mgmtOK = false;
        try {
            const resp = await fetch(mgmtURL, {
                method: 'GET',
                headers: { Authorization: `Bearer ${accessToken}` },
            });
            mgmtStatus = resp.status;
            mgmtRaw = await resp.text();
            mgmtOK = mgmtStatus < 400;
        } catch (err) {
            mgmtRaw = err.message;
        }
        steps.push({
            title: '7. Call PingOne Management API',
            ok: mgmtOK,
            url: `GET ${mgmtURL}`,
            detail: `The access token is sent as a Bearer token directly to the management API — no risk evaluation is performed.<br>HTTP ${mgmtStatus}`,
            rawDetail: true,
            body: pretty(mgmtRaw),
        });
        return { success: true, steps };
    }

    // Protect path — resolve a policy set, then gate each call on risk.
    const policySet = await resolveRiskPolicySet(accessToken, apiPath, envID);
    if (!policySet) {
        steps.push({
            title: '7. PingOne Protect risk evaluation',
            ok: false,
            detail: 'No risk policy set is readable in this environment. PingOne Protect may not be licensed, or the worker app lacks the Environment Admin role.',
        });
        return { success: false, steps };
    }

    const riskURL = `${apiPath}/v1/environments/${envID}/riskEvaluations`;
    const baseEvent = (ip, tag, userAgent, userID) => ({
        event: {
            ip,
            flow: { type: 'AUTHENTICATION' },
            session: { id: `m2m-demo-session-${tag}` },
            user: { id: userID, type: 'EXTERNAL', name: userID },
            browser: { userAgent },
            sharingType: 'SHARED',
            targetResource: { id: 'm2m-demo-resource', name: 'm2m-demo-resource' },
        },
        riskPolicySet: { id: policySet.id },
    });

    // 7a / 8a — trusted caller: the real caller IP, a normal user agent.
    steps.push({ divider: true, title: 'User A — trusted (real IP, type=EXTERNAL)' });
    const resultA = await runRiskAndGate(
        accessToken, riskURL, mgmtURL,
        baseEvent(callerIP(req), 'a', req.headers['user-agent'] || '', 'm2m-user-trusted'),
        '7a', '8a',
    );
    steps.push(...resultA.steps);

    // 7b / 8b — suspicious caller: a known Tor exit node and a bot user agent.
    steps.push({ divider: true, title: 'User B — suspicious (Tor IP)' });
    const resultB = await runRiskAndGate(
        accessToken, riskURL, mgmtURL,
        baseEvent('185.220.101.1', 'b', 'python-requests/2.28.0', 'm2m-user-suspicious'),
        '7b', '8b',
    );
    steps.push(...resultB.steps);

    return { success: true, steps, policySet };
}

// --- routes ---

// GET /api/m2m-sample/config — what the page needs to render before a run.
// Never returns the client secret.
router.get('/config', async (_req, res) => {
    const { envID, clientID, clientSecret, authPath, apiPath } = creds();
    const configured = Boolean(envID && clientID && clientSecret);

    let policySet = null;
    if (configured) {
        const tok = await getAccessToken(creds());
        if (tok.ok && tok.parsed && tok.parsed.access_token) {
            policySet = await resolveRiskPolicySet(tok.parsed.access_token, apiPath, envID);
        }
    }

    res.json({
        configured,
        envID,
        clientID,
        authPath,
        apiPath,
        protectAvailable: Boolean(policySet),
        policySet,
    });
});

// POST /api/m2m-sample/run { protect: boolean } — run the workflow.
router.post('/run', express.json(), async (req, res) => {
    const useProtect = req.body && req.body.protect === true;
    try {
        const result = await runWorkflow(req, useProtect);
        res.json(result);
    } catch (err) {
        res.status(500).json({
            success: false,
            steps: [{ title: 'Workflow error', ok: false, detail: err.message }],
        });
    }
});

module.exports = router;

// Exported for tests — the redaction is security-relevant on a public route.
module.exports._maskTokenResponse = maskTokenResponse;
