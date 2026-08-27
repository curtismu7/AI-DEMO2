// Native-flow samples — server-side workflow runner for mfa-demo and
// user-registration.
//
// Port of ping-rocks/devdocs-sample-apps mfa-demo and user-registration. Both
// samples drive PingOne with response_mode=pi.flow, so they share one route:
// the mechanics are identical and only the vendor content types differ.
//
//   1. GET  /as/authorize?...&response_mode=pi.flow  -> flow id, session cookies
//   2. POST /flows/{id}  <vendor content type>       -> submit credentials
//   3. POST /flows/{id}  <vendor content type>       -> submit the one-time code
//   4. GET  /as/resume?flowId=                       -> authorization code
//   5. POST /as/token                                -> tokens
//
// Step 3 is why these two could not be wired like custom-admin-role: PingOne
// emails a code and a human has to read it. So the run is split in two —
// POST /run gets as far as the code being sent, POST /otp finishes it — with
// the flow state parked in memory in between.
//
// Cookies: this environment sets none on /as/authorize, and both legs work
// without them. The samples capture and replay ST/ST-NO-SS anyway, and so does
// this route: an environment that does issue them would otherwise 401 here
// with nothing in the response explaining why.
//
// user-registration creates a real account on every run. The upstream sample
// has no teardown; this route deletes the account it made unless the caller
// opts out, so the page stays safe to click on a shared tenant.

const express = require('express');

const router = express.Router();

const REGION_TLD = { com: 'com', eu: 'eu', ca: 'ca', asia: 'asia', 'com.au': 'com.au' };

// Flow state between /run and /otp, keyed by flow id. Entries are dropped when
// the flow finishes; FLOW_TTL_MS sweeps the ones abandoned at the OTP prompt.
// ponytail: the sweep is driven by the next request rather than a timer, so an
// abandoned registration survives until someone loads the page again. Add an
// interval if that ever leaves accounts around for longer than it should.
const flows = new Map();
const FLOW_TTL_MS = 15 * 60 * 1000;

// PingOne statuses that mean "a one-time code has been sent, ask for it".
const OTP_PENDING = [
    'OTP_REQUIRED',
    'DEVICE_SELECTION_REQUIRED',
    'MULTI_FACTOR_AUTHENTICATION_REQUIRED',
    'VERIFICATION_CODE_REQUIRED',
];

const SAMPLES = {
    'mfa-demo': {
        // Sign-in: check credentials, then the OTP from the enrolled email device.
        submitType: 'application/vnd.pingidentity.usernamePassword.check+json',
        otpType: 'application/vnd.pingidentity.otp.check+json',
        creates: false,
    },
    'user-registration': {
        // Sign-up: create the account, then the emailed verification code.
        submitType: 'application/vnd.pingidentity.user.register+json',
        otpType: 'application/vnd.pingidentity.user.verify+json',
        creates: true,
    },
};

function creds() {
    const regionKey = process.env.PINGONE_REGION || process.env.PINGONE_BOOTSTRAP_REGION;
    const region = REGION_TLD[regionKey] || 'com';
    return {
        envID: process.env.PINGONE_ENVIRONMENT_ID
            || process.env.PINGONE_WORKER_ENV_ID
            || '',
        workerClientID: process.env.PINGONE_WORKER_CLIENT_ID || '',
        workerClientSecret: process.env.PINGONE_WORKER_CLIENT_SECRET || '',
        clientID: process.env.PINGONE_SAMPLE_FLOW_CLIENT_ID || '',
        clientSecret: process.env.PINGONE_SAMPLE_FLOW_CLIENT_SECRET || '',
        redirectURI: process.env.PINGONE_SAMPLE_FLOW_REDIRECT_URI || 'http://localhost:3000/callback',
        username: process.env.PINGONE_SAMPLE_TEST_USERNAME || '',
        password: process.env.PINGONE_SAMPLE_TEST_PASSWORD || '',
        email: process.env.PINGONE_SAMPLE_TEST_EMAIL || '',
        authPath: `https://auth.pingone.${region}`,
        apiPath: `https://api.pingone.${region}`,
    };
}

function pretty(raw) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (_) { return raw; }
}

function escapeHTML(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Redact the secrets a raw PingOne body may carry before it reaches the page.
function scrub(raw) {
    return String(raw).replace(
        /("(?:access_token|id_token|refresh_token|password|verificationCode|otp)"\s*:\s*")[^"]*"/g,
        '$1<redacted>"',
    );
}

function captureCookies(session, resp) {
    const setCookie = resp.headers.getSetCookie ? resp.headers.getSetCookie() : [];
    for (const raw of setCookie) {
        const nameValue = raw.split(';')[0];
        const name = nameValue.split('=')[0];
        const idx = session.cookies.findIndex((c) => c.startsWith(`${name}=`));
        if (idx >= 0) session.cookies[idx] = nameValue;
        else session.cookies.push(nameValue);
    }
}

function cookieHeader(session) {
    return session.cookies.join('; ');
}

async function getWorkerToken({ authPath, envID, workerClientID, workerClientSecret }) {
    const basic = Buffer.from(`${workerClientID}:${workerClientSecret}`).toString('base64');
    const resp = await fetch(`${authPath}/${envID}/as/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials',
    });
    if (resp.status >= 400) throw new Error(`worker token request failed (HTTP ${resp.status})`);
    const parsed = await resp.json();
    if (!parsed.access_token) throw new Error('no access_token in worker token response');
    return parsed.access_token;
}

// POST a flow action. `type` is the vendor content type that selects which
// action the flow engine performs — application/json returns 415 here.
// No Authorization header: /flows/{id} is served by auth.pingone.com, and the
// worker token's audience is the management API, so PingOne rejects it here
// with ACCESS_FAILED / INVALID_TOKEN. The mfa-demo sample sends one anyway and
// its comments claim "both headers are required; omitting either causes a 401"
// — verified false against this environment: with the bearer the credential
// leg fails, without it the same call returns OTP_REQUIRED. The worker token is
// still needed, but only for the management-API teardown call.
async function postFlow(session, type, body) {
    const { authPath, envID } = session.creds;
    const headers = {
        'Content-Type': type,
        Accept: '*/*',
        Cookie: cookieHeader(session),
    };
    const url = `${authPath}/${envID}/flows/${session.flowID}`;
    const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'manual',
    });
    captureCookies(session, resp);
    const rawText = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) { /* errors may be empty */ }
    // PingOne may hand back a new flow id mid-flow; always follow the latest.
    if (parsed && parsed.id) session.flowID = parsed.id;
    return { status: resp.status, rawText, parsed, url };
}

// Drop abandoned flows. A registration that is never finished has already
// created an account, and teardown otherwise only runs when the code is
// submitted — so sweep the account too, or walking away from the OTP prompt
// leaves exactly the debris the cleanup step exists to prevent.
function reap() {
    const cutoff = Date.now() - FLOW_TTL_MS;
    for (const [id, s] of flows) {
        if (s.startedAt >= cutoff) continue;
        flows.delete(id);
        if (s.createdUserID && s.cleanup && s.workerToken) {
            const { apiPath, envID } = s.creds;
            fetch(`${apiPath}/v1/environments/${envID}/users/${s.createdUserID}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${s.workerToken}` },
            }).catch(() => { /* best effort; the token may have expired too */ });
        }
    }
}

// Steps 4 and 5 — turn a COMPLETED flow into tokens. Shared by both samples,
// though only mfa-demo's upstream does this; see the note on the caller.
async function resumeAndExchange(session, steps) {
    const { authPath, envID, clientID, clientSecret, redirectURI } = session.creds;

    const resumeURL = `${authPath}/${envID}/as/resume?flowId=${session.flowID}`;
    const resumeResp = await fetch(resumeURL, {
        headers: { Accept: '*/*', Cookie: cookieHeader(session) },
        redirect: 'manual',
    });
    captureCookies(session, resumeResp);

    let code = '';
    const contentType = resumeResp.headers.get('content-type') || '';
    const resumeBody = await resumeResp.text();
    if (contentType.includes('json')) {
        try { code = JSON.parse(resumeBody)?.authorizeResponse?.code || ''; } catch (_) { /* fall through */ }
    }
    if (!code) {
        const loc = resumeResp.headers.get('location');
        // The redirect_uri is never visited — only parsed for its ?code=.
        if (loc) { try { code = new URL(loc).searchParams.get('code') || ''; } catch (_) { /* not a URL */ } }
    }

    steps.push({
        title: 'Resume the flow for an authorization code',
        ok: Boolean(code),
        url: `GET ${resumeURL}`,
        body: scrub(pretty(resumeBody)) || `(no body; HTTP ${resumeResp.status})`,
        detail: code
            ? 'The native flow is done, so <code>/as/resume</code> hands back an ordinary OAuth authorization code — either in the JSON body or on a 302 to the redirect URI. From here it is a completely standard code exchange.<br>'
                + `HTTP ${resumeResp.status}`
            : 'No authorization code came back. The flow completed but did not resume into an authenticated OAuth session.<br>'
                + `HTTP ${resumeResp.status}`,
        rawDetail: true,
    });
    if (!code) return false;

    const basic = Buffer.from(`${clientID}:${clientSecret}`).toString('base64');
    const tokenURL = `${authPath}/${envID}/as/token`;
    const tokenResp = await fetch(tokenURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectURI,
        }),
    });
    const tokenBody = await tokenResp.text();
    let token = null;
    try { token = JSON.parse(tokenBody); } catch (_) { /* leave null */ }
    const ok = Boolean(token && token.access_token);

    steps.push({
        title: 'Exchange the code for tokens',
        ok,
        url: `POST ${tokenURL}`,
        body: scrub(pretty(tokenBody)),
        detail: ok
            ? `<code>redirect_uri</code> must match the authorize request exactly even though nothing ever visits it — PingOne compares the two values. Scopes granted: <code>${escapeHTML(token.scope || '(none)')}</code>. Token values are redacted here.<br>HTTP ${tokenResp.status}`
            : `The code exchange did not return an access token.<br>HTTP ${tokenResp.status}`,
        rawDetail: true,
    });
    return ok;
}

// Delete the account the registration sample created. Not in the upstream
// sample, which leaves one behind on every run.
async function teardown(session, steps) {
    const { apiPath, envID } = session.creds;
    if (!session.createdUserID) return;
    if (!session.cleanup) {
        steps.push({
            title: 'Clean up — skipped',
            ok: true,
            detail: `Left in place at your request: user <code>${escapeHTML(session.createdUserID)}</code> in the <code>Sample Apps Registrations</code> population. Delete it in the PingOne console when you are done.`,
            rawDetail: true,
        });
        return;
    }
    const url = `${apiPath}/v1/environments/${envID}/users/${session.createdUserID}`;
    const resp = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.workerToken}` },
    });
    steps.push({
        title: 'Clean up (not in the upstream sample)',
        ok: resp.status < 400,
        url: `DELETE ${url}`,
        detail: 'The upstream sample has no teardown — every run leaves an account behind. '
            + `This page deletes the one it just created.<br>DELETE user → HTTP ${resp.status}`,
        rawDetail: true,
    });
}

// GET /api/native-flow-sample/config
router.get('/config', (_req, res) => {
    const c = creds();
    const configured = Boolean(
        c.envID && c.workerClientID && c.workerClientSecret
        && c.clientID && c.clientSecret && c.username && c.password && c.email,
    );
    res.json({
        configured,
        envID: c.envID,
        clientID: c.clientID,
        // The page tells the operator which inbox to go and read.
        otpEmail: c.email,
    });
});

// POST /api/native-flow-sample/run { sample, cleanup? }
// Runs as far as PingOne emailing a one-time code, then stops and asks for it.
router.post('/run', express.json(), async (req, res) => {
    reap();
    const sample = req.body && req.body.sample;
    const cfg = SAMPLES[sample];
    if (!cfg) return res.status(400).json({ error: `unknown sample: ${sample}` });

    const c = creds();
    const missing = ['envID', 'workerClientID', 'workerClientSecret', 'clientID', 'clientSecret']
        .filter((k) => !c[k]);
    if (missing.length || (sample === 'mfa-demo' && (!c.username || !c.password))) {
        return res.json({
            success: false,
            steps: [{
                title: 'Configuration missing',
                ok: false,
                detail: 'The API server needs the sample native-flow app: PINGONE_SAMPLE_FLOW_CLIENT_ID / _SECRET and a PingOne worker app.',
            }],
        });
    }

    const steps = [];
    try {
        const session = {
            creds: c,
            cookies: [],
            sample,
            cleanup: !(req.body && req.body.cleanup === false),
            startedAt: Date.now(),
            createdUserID: null,
        };

        // Only needed to delete the account afterwards, so only fetched by the
        // sample that creates one. The flow legs themselves take no bearer.
        if (cfg.creates) session.workerToken = await getWorkerToken(c);

        // Step 1 — open the flow.
        const authURL = `${c.authPath}/${c.envID}/as/authorize`
            + `?response_type=code&client_id=${encodeURIComponent(c.clientID)}`
            + `&redirect_uri=${encodeURIComponent(c.redirectURI)}`
            + '&scope=openid%20profile&response_mode=pi.flow';
        const initResp = await fetch(authURL, { headers: { Accept: '*/*' }, redirect: 'manual' });
        captureCookies(session, initResp);
        const initBody = await initResp.text();
        let init = null;
        try { init = JSON.parse(initBody); } catch (_) { /* leave null */ }
        if (!init || !init.id) {
            steps.push({
                title: 'Start the native flow',
                ok: false,
                url: `GET ${authURL}`,
                body: scrub(pretty(initBody)),
                detail: `No flow id came back from /as/authorize.<br>HTTP ${initResp.status}`,
                rawDetail: true,
            });
            return res.json({ success: false, steps });
        }
        session.flowID = init.id;
        steps.push({
            title: 'Start the native flow',
            ok: true,
            url: `GET ${authURL}`,
            body: scrub(pretty(initBody)),
            detail: '<code>response_mode=pi.flow</code> is what makes this a native flow: PingOne returns JSON flow state instead of redirecting a browser. '
                + `Status <code>${escapeHTML(init.status || '')}</code>. `
                + `Session cookies set: <code>${session.cookies.length ? escapeHTML(session.cookies.map((x) => x.split('=')[0]).join(', ')) : 'none'}</code> — this environment sets none, so the flow id alone carries the state.<br>`
                + `HTTP ${initResp.status}`,
            rawDetail: true,
        });

        // Step 2 — submit credentials, or register the new account.
        let payload;
        let title;
        let detail;
        if (sample === 'mfa-demo') {
            payload = { username: c.username, password: c.password };
            title = 'Submit the username and password';
            detail = `<code>${escapeHTML(cfg.submitType)}</code> is the Content-Type that selects the credential-check action. Sending <code>application/json</code> returns 415, and restricting <code>Accept</code> to JSON returns 406 — PingOne answers in vendor types.`;
        } else {
            const suffix = `${Math.floor(Date.now() / 1000)}`;
            const [local, domain] = c.email.split('@');
            payload = {
                username: `sample-reg-${suffix}`,
                // Plus-addressed so every run is identifiable and the code still
                // reaches the same inbox.
                email: domain ? `${local}+sample-reg-${suffix}@${domain}` : c.email,
                password: `Sample-Reg-${suffix}-Aa1!`,
            };
            title = 'Register the new account';
            detail = `<code>${escapeHTML(cfg.submitType)}</code> selects the registration action. PingOne validates the password against the environment policy before creating anything, and the account lands in the population named on the sign-on policy.`;
        }

        const submit = await postFlow(session, cfg.submitType, payload);
        const status = submit.parsed && submit.parsed.status;
        if (cfg.creates && submit.parsed) {
            session.createdUserID = submit.parsed._embedded && submit.parsed._embedded.user
                ? submit.parsed._embedded.user.id
                : null;
        }
        steps.push({
            title,
            ok: submit.status < 400 && Boolean(status),
            url: `POST ${submit.url}`,
            body: scrub(pretty(submit.rawText)),
            detail: `${detail}<br>Status <code>${escapeHTML(status || '(none)')}</code> · HTTP ${submit.status}`,
            rawDetail: true,
        });
        if (submit.status >= 400 || !status) {
            if (cfg.creates) await teardown(session, steps);
            return res.json({ success: false, steps });
        }

        // Already done — no second factor and no verification configured.
        if (status === 'COMPLETED') {
            const ok = await resumeAndExchange(session, steps);
            if (cfg.creates) await teardown(session, steps);
            return res.json({ success: ok, steps });
        }

        if (!OTP_PENDING.includes(status)) {
            if (cfg.creates) await teardown(session, steps);
            return res.json({ success: false, steps });
        }

        // Park the flow and hand the page an OTP prompt.
        flows.set(session.flowID, session);
        return res.json({
            success: true,
            steps,
            flowId: session.flowID,
            otpPrompt: sample === 'mfa-demo'
                ? `PingOne has emailed a one-time passcode to ${c.email}. Read it from that inbox and enter it below.`
                : `PingOne has emailed a verification code to ${escapeHTML(payload.email)}, which is delivered to ${c.email}. Read it from that inbox and enter it below.`,
        });
    } catch (err) {
        return res.status(500).json({
            error: err.message,
            success: false,
            steps: steps.concat([{ title: 'Workflow error', ok: false, detail: escapeHTML(err.message) }]),
        });
    }
});

// POST /api/native-flow-sample/otp { flowId, otp }
// Finishes a flow parked by /run.
router.post('/otp', express.json(), async (req, res) => {
    reap();
    const flowId = req.body && req.body.flowId;
    const otp = String((req.body && req.body.otp) || '').trim();
    const session = flows.get(flowId);
    if (!session) {
        return res.status(410).json({
            error: 'flow expired',
            success: false,
            steps: [{
                title: 'Flow expired',
                ok: false,
                detail: 'That flow is no longer held on the server — codes are only good for a few minutes. Run it again to get a fresh one.',
            }],
        });
    }
    if (!otp) return res.status(400).json({ error: 'otp is required' });

    const cfg = SAMPLES[session.sample];
    const steps = [];
    try {
        const body = session.sample === 'mfa-demo' ? { otp } : { verificationCode: otp };
        const check = await postFlow(session, cfg.otpType, body);
        const status = check.parsed && check.parsed.status;
        steps.push({
            title: session.sample === 'mfa-demo' ? 'Check the one-time passcode' : 'Verify the emailed code',
            ok: status === 'COMPLETED',
            url: `POST ${check.url}`,
            body: scrub(pretty(check.rawText)),
            detail: `<code>${escapeHTML(cfg.otpType)}</code> tells the flow engine this POST carries a code rather than another attempt at the previous action.<br>`
                + `Status <code>${escapeHTML(status || '(none)')}</code> · HTTP ${check.status}`,
            rawDetail: true,
        });

        let success = false;
        if (status === 'COMPLETED') {
            success = await resumeAndExchange(session, steps);
        }
        await teardown(session, steps);
        flows.delete(flowId);
        flows.delete(session.flowID);
        return res.json({ success, steps });
    } catch (err) {
        flows.delete(flowId);
        return res.status(500).json({
            error: err.message,
            success: false,
            steps: steps.concat([{ title: 'Workflow error', ok: false, detail: escapeHTML(err.message) }]),
        });
    }
});

module.exports = router;
module.exports._SAMPLES = SAMPLES;
module.exports._OTP_PENDING = OTP_PENDING;
module.exports._scrub = scrub;
