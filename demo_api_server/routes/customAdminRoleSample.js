// Custom Admin Role sample — server-side workflow runner.
//
// Port of ping-rocks/devdocs-sample-apps custom-admin-role, wired to this
// demo's PingOne worker app. Returns the same step objects the upstream sample
// renders as cards.
//
// Steps (matching the sample):
//   1. client_credentials token
//   2. choose the permissions for the custom role
//   3. POST /environments/{env}/roles          -> create the custom role
//   4. POST /environments/{env}/applications   -> create a demo worker app
//   5. POST .../applications/{id}/roleAssignments -> assign it
//   6. GET  .../applications/{id}/roleAssignments -> verify
//   7. clean up (NOT in the upstream sample — see below)
//
// The upstream sample has no teardown: every run leaves a role and an app
// behind. That is tolerable on a developer's own sandbox and not tolerable on
// a shared demo tenant that anyone can click, so this route deletes what it
// created unless the caller opts out.

const express = require('express');

const router = express.Router();

const REGION_TLD = { com: 'com', eu: 'eu', ca: 'ca', asia: 'asia', 'com.au': 'com.au' };

// Environment Admin's fixed, global platform-role ID. The sample hardcodes
// this deliberately: an Environment Admin worker cannot GET /roles to look it
// up, because listing platform roles requires Organization Admin.
const ENV_ADMIN_ROLE_ID = '29ddce68-cd7f-4b2a-b6fc-f7a19553b496';

function creds() {
    const regionKey = process.env.PINGONE_REGION || process.env.PINGONE_BOOTSTRAP_REGION;
    const region = REGION_TLD[regionKey] || 'com';
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

async function getAdminToken({ authPath, envID, clientID, clientSecret }) {
    const basic = Buffer.from(`${clientID}:${clientSecret}`).toString('base64');
    const resp = await fetch(`${authPath}/${envID}/as/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials',
    });
    const raw = await resp.text();
    if (resp.status >= 400) throw new Error(`token request failed (HTTP ${resp.status})`);
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) throw new Error('no access_token in response');
    return parsed.access_token;
}

async function apiCall(method, path, token, apiPath, body) {
    const fullURL = `${apiPath}/v1${path}`;
    const opts = {
        method,
        headers: { Authorization: `Bearer ${token}` },
    };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const resp = await fetch(fullURL, opts);
    const rawText = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) { /* 204 and errors may be empty */ }
    return { status: resp.status, rawText, parsed, fullURL };
}

async function runWorkflow({ cleanup }) {
    const { envID, clientID, clientSecret, authPath, apiPath } = creds();
    const steps = [];

    if (!envID || !clientID || !clientSecret) {
        return {
            success: false,
            steps: [{
                title: 'Configuration missing',
                ok: false,
                detail: 'The API server needs a PingOne worker app: PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID and PINGONE_WORKER_CLIENT_SECRET.',
            }],
        };
    }

    // Step 1 — admin token.
    let token;
    try {
        token = await getAdminToken({ authPath, envID, clientID, clientSecret });
    } catch (err) {
        steps.push({ title: '1. Obtain admin access token', ok: false, detail: escapeHTML(err.message) });
        return { success: false, steps };
    }
    steps.push({
        title: '1. Obtain admin access token',
        ok: true,
        url: `POST ${authPath}/${envID}/as/token`,
        detail: 'client_credentials grant succeeded. The worker app must already hold <strong>Environment Admin</strong> — without it every call below returns 403.',
        rawDetail: true,
    });

    // Step 2 — choose the permissions.
    const selected = [
        { id: 'applications:read:application' },
        { id: 'applications:update:application' },
    ];
    steps.push({
        title: '2. Select read/update application permissions',
        ok: true,
        detail: 'Permission IDs use <code>service:action:resource</code>. Read + update on applications is deliberately narrower than Environment Admin: holders can view and change apps but not create or delete them.',
        rawDetail: true,
        body: JSON.stringify(selected, null, 2),
    });

    const suffix = Math.floor(Date.now() / 1000);
    let customRoleID = null;
    let demoAppID = null;

    // Step 3 — create the custom role.
    const rolePayload = {
        name: `Application Manager (Read/Update) ${suffix}`,
        description: 'Read and update applications; cannot create or delete them.',
        applicableTo: ['ENVIRONMENT'],
        permissions: selected,
        canBeAssignedBy: [{ id: ENV_ADMIN_ROLE_ID }],
    };
    let res = await apiCall('POST', `/environments/${envID}/roles`, token, apiPath, rolePayload);
    const step3 = {
        title: '3. Create custom admin role',
        url: `POST ${res.fullURL}`,
        body: `request:\n${JSON.stringify(rolePayload, null, 2)}\n\nresponse:\n${pretty(res.rawText)}`,
        detail: `<code>applicableTo: ["ENVIRONMENT"]</code> assigns at environment scope. <code>canBeAssignedBy</code> names the Environment Admin role — that is what unlocks delegation, and it is why the sample hardcodes the role ID rather than looking it up.<br>HTTP ${res.status}`,
        rawDetail: true,
    };
    if (res.status >= 400 || !(res.parsed && res.parsed.id)) {
        step3.ok = false;
        steps.push(step3);
        return { success: false, steps };
    }
    customRoleID = res.parsed.id;
    step3.ok = true;
    steps.push(step3);

    // Step 4 — create a demo worker app to receive the assignment.
    const appPayload = {
        name: `Custom Role Demo App ${suffix}`,
        enabled: true,
        type: 'WORKER',
        protocol: 'OPENID_CONNECT',
        grantTypes: ['CLIENT_CREDENTIALS'],
        tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC',
    };
    res = await apiCall('POST', `/environments/${envID}/applications`, token, apiPath, appPayload);
    const step4 = {
        title: '4. Create demo worker app',
        url: `POST ${res.fullURL}`,
        body: pretty(res.rawText),
        detail: `A WORKER app with the CLIENT_CREDENTIALS grant — the standard shape for server-to-server admin work. Created inside the workflow so the demo is self-contained.<br>HTTP ${res.status}`,
        rawDetail: true,
    };
    if (res.status >= 400 || !(res.parsed && res.parsed.id)) {
        step4.ok = false;
        steps.push(step4);
        return { success: false, steps, customRoleID };
    }
    demoAppID = res.parsed.id;
    step4.ok = true;
    steps.push(step4);

    // Step 5 — assign.
    const assignPayload = { role: { id: customRoleID }, scope: { id: envID, type: 'ENVIRONMENT' } };
    res = await apiCall('POST', `/environments/${envID}/applications/${demoAppID}/roleAssignments`, token, apiPath, assignPayload);
    const step5 = {
        title: '5. Assign custom role to demo app',
        ok: res.status < 400,
        url: `POST ${res.fullURL}`,
        body: `request:\n${JSON.stringify(assignPayload, null, 2)}\n\nresponse:\n${pretty(res.rawText)}`,
        detail: `<code>scope.type=ENVIRONMENT</code> confines the role to this one environment. Scope is what stops a delegated admin role becoming a global one.<br>HTTP ${res.status}`,
        rawDetail: true,
    };
    steps.push(step5);

    // Step 6 — verify.
    res = await apiCall('GET', `/environments/${envID}/applications/${demoAppID}/roleAssignments`, token, apiPath);
    const found = res.rawText.includes(customRoleID);
    steps.push({
        title: '6. Verify app role assignments',
        ok: res.status < 400 && found,
        url: `GET ${res.fullURL}`,
        body: pretty(res.rawText),
        detail: found
            ? `The demo app now holds custom role <code>${escapeHTML(customRoleID)}</code>.<br>HTTP ${res.status}`
            : `The custom role does not appear in the assignments yet.<br>HTTP ${res.status}`,
        rawDetail: true,
    });

    // Step 7 — clean up. Not part of the upstream sample.
    if (cleanup) {
        const delApp = await apiCall('DELETE', `/environments/${envID}/applications/${demoAppID}`, token, apiPath);
        const delRole = await apiCall('DELETE', `/environments/${envID}/roles/${customRoleID}`, token, apiPath);
        const ok = delApp.status < 400 && delRole.status < 400;
        steps.push({
            title: '7. Clean up (not in the upstream sample)',
            ok,
            detail: 'The upstream sample has no teardown — every run leaves a role and an app behind. '
                + 'This page deletes both so it stays safe to click repeatedly.<br>'
                + `DELETE application → HTTP ${delApp.status} &middot; DELETE role → HTTP ${delRole.status}`,
            rawDetail: true,
        });
    } else {
        steps.push({
            title: '7. Clean up — skipped',
            ok: true,
            detail: `Left in place at your request: role <code>${escapeHTML(customRoleID)}</code> and app <code>${escapeHTML(demoAppID)}</code>. Delete them in the PingOne console when you are done.`,
            rawDetail: true,
        });
    }

    return { success: true, steps, customRoleID, demoAppID };
}

// GET /api/custom-admin-role-sample/config
router.get('/config', (_req, res) => {
    const { envID, clientID, clientSecret } = creds();
    res.json({
        configured: Boolean(envID && clientID && clientSecret),
        envID,
        clientID,
        writes: true,
    });
});

// POST /api/custom-admin-role-sample/run { cleanup?: boolean }
router.post('/run', express.json(), async (req, res) => {
    const cleanup = !(req.body && req.body.cleanup === false);
    try {
        res.json(await runWorkflow({ cleanup }));
    } catch (err) {
        // demo_api_server convention: error responses carry `error`. `steps` is
        // added alongside so the page can still render what happened.
        res.status(500).json({
            error: err.message,
            success: false,
            steps: [{ title: 'Workflow error', ok: false, detail: escapeHTML(err.message) }],
        });
    }
});

module.exports = router;
module.exports._ENV_ADMIN_ROLE_ID = ENV_ADMIN_ROLE_ID;
