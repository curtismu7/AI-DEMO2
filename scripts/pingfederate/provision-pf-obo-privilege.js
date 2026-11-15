#!/usr/bin/env node
'use strict';
/**
 * Re-provision the PingFederate side of the Privilege OBO demo (/privilege-pf-token).
 *
 * The client pf-route-c-test, the access token manager routeCTestAtm and their exchange
 * pieces existed on the local Docker PingFederate in October 2026 but did not survive a
 * later PF rebuild (verified 2026-11-13: GET /oauth/clients/pf-route-c-test -> 404, the
 * ATM list has no routeCTestAtm). The Privilege side is intact (NHI PFtoken with the
 * required claims act.sub + client_id, key pftoken-agent, doors pftoken / pftoken-rs);
 * this script restores only the PF side. See privilege/PF-OBO-WITH-PINGFEDERATE-SETUP.md.
 *
 * Creates (idempotently, dry run by default):
 *   1. vault secret PF_TOKEN_DEMO_CLIENT_SECRET (the BFF reads it for /privilege-pf-token)
 *   2. the scopes mcp, opensearch:read, whoami:read (additive, only if missing) — the
 *      opensearch/whoami scopes are what the Privilege grant's scope tiers and the
 *      pftoken-rs backend require
 *   3. ATM routeCTestAtm - clone of aiDemoPfJwtAtm with
 *        audience = the pftoken door, issuer = the PF public issuer
 *        NOTE on signing: the token's kid must appear in PF's published /pf/JWKS — the
 *        Privilege NHI fetches that JWKS and the gateway refuses a kid it cannot find
 *        ("signature does not verify against any known key", hit live 2026-11-13). The
 *        centralized signing key is NOT published there, so the ATM must use the per-ATM
 *        certificate with a unique key id (-routec suffix) and publish to JWKS.
 *   4. token exchange processor policy aiDemoPfOboPrivilegePolicy
 *        subject = OIDC ID token (processor aiDemoPfAccessSubjectProcessor — the refresh
 *        token processor binds the token to the client that received it, so a refresh
 *        token minted for ai-demo-pf-user is refused here), NO actor required
 *        extended attributes: scope, client_id
 *   5. access token mapping (token-exchange | policy | routeCTestAtm)
 *        sub = subject token's sub (the USER - the OBO shape)
 *        act = expression producing a JSON object {"sub": "pf-route-c-test"} (must be an
 *              object; the text "{}" is rejected by the gateway's act.sub check)
 *        client_id = subject token's client_id (the agent)
 *        scope, Username from the policy contract; spiffeId "" (the cloned ATM contract
 *        requires every extended attribute to be fulfilled)
 *   6. token exchange SP connection aiDemoPfPrivilegeOboSp whose resourceUris contain the
 *      door URL — PF validates the exchange's `audience`/`resource` against it; without
 *      it the exchange fails with invalid_target
 *   7. confidential client pf-route-c-test: CLIENT_CREDENTIALS + TOKEN_EXCHANGE grants,
 *      the policy above, default ATM routeCTestAtm, restricted to the scopes above
 *
 * The shared subject processor aiDemoPfAccessSubjectProcessor is also extended
 * (additively) with the PF public issuer + JWKS URL and the ai-demo-pf-user audience,
 * so it accepts the id_token the demo user sign-in produces.
 *
 * Gateway OBO (Privilege MCP app Auth Mode "OBO", app testobo -> the pftoken-rs backend):
 * the gateway itself exchanges the caller's verified PF access token at PF for a token
 * aimed at the backend. Added for that, same idempotent steps:
 *   8. vault secret PF_GW_OBO_CLIENT_SECRET (typed into the Privilege OBO wizard)
 *   9. subject processor aiDemoPfAccessSubjectProcessor also accepts the gateway door
 *      audience (the agent token the gateway exchanges carries aud = the testobo door)
 *  10. ATM privilegeGwOboAtm - clone of aiDemoPfJwtAtm, audience = the backend resource
 *      (mcp-resource-server.ping.demo, already in the backend's accepted audiences)
 *  11. processor policy aiDemoPfGwOboPolicy - subject = ACCESS token (not id token)
 *  12. mapping: sub = user, act = {"sub": "privilege-gw-obo"}, client_id = the agent's
 *  13. token exchange SP connection aiDemoPfGwOboSp, resourceUris = the backend resource
 *      (the gateway sends resource=; without a matching SP PF answers invalid_target)
 *  14. confidential client privilege-gw-obo: TOKEN_EXCHANGE only, client_secret_basic
 * Wizard values: Token URL https://cmuir-pf.ping-devops.com/as/token.oauth2, client
 * privilege-gw-obo, subject/requested type access_token, Resource = PF_GW_OBO_RESOURCE.
 *
 * The BFF also needs PF_TOKEN_DEMO_CLIENT_SECRET in demo_api_server/.env (and the
 * compose environment) - the vault set above is the source; copy it if the .env copy
 * is missing. Restart the api-server after changing it.
 *
 * Usage:
 *   node scripts/pingfederate/provision-pf-obo-privilege.js            # dry run
 *   node scripts/pingfederate/provision-pf-obo-privilege.js --apply
 *
 * Never prints a password or a secret.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');
const MAIN = path.dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const PF_BASE = process.env.PF_BASE || 'https://local.ping-devops.com:9999/pf-admin-api/v1';
const CONTAINER = process.env.PINGFEDERATE_CONTAINER_NAME || 'ai-demo-pingfederate';

const DOOR = process.env.PF_TOKEN_DEMO_DOOR_URL || 'https://mcpgw.ai-demo.ping-devops.com/pftoken/mcp';
const CLIENT_ID = 'pf-route-c-test';
const CLIENT_NAME = 'Privilege PF token demo agent';
const ATM_ID = 'routeCTestAtm';
const ATM_NAME = 'Privilege PF token demo access tokens';
const TEMPLATE_ATM = 'aiDemoPfJwtAtm';
const SIGNING_KEY_ID = 'aidemopf-idjag-signing';
const POLICY_ID = 'aiDemoPfOboPrivilegePolicy';
const POLICY_NAME = 'AI Demo PF Privilege OBO Exchange';
const JWT_PROCESSOR_ID = 'aiDemoPfAccessSubjectProcessor';
const REFRESH_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:id_token';
const AGENT_ACT = CLIENT_ID; // act.sub: the agent acting on the user's behalf
const VAULT_SECRET = 'PF_TOKEN_DEMO_CLIENT_SECRET';
// Scopes the Privilege grant's scope tiers (opensearch:read/admin) and the pftoken-rs
// backend (whoami:read) require; the client allowlist caps what can be requested. The
// /privilege-pf-token page's tiers request exactly these (SCOPE_TIERS in
// routes/pfTokenPrivilegeDemo.js) — keep in step with them.
const SCOPES = ['mcp', 'opensearch:read', 'opensearch:admin', 'whoami:read'];
// The user sign-in client whose id_token is the OBO subject token.
const USER_CLIENT_ID = 'ai-demo-pf-user';
const PF_ISSUER = 'https://cmuir-pf.ping-devops.com';
const PF_JWKS = `${PF_ISSUER}/pf/JWKS`;

// Gateway OBO (the gateway does the exchange). GW_DOOR is the aud of the agent token the
// gateway exchanges; GW_RESOURCE is the aud of the token the pftoken-rs backend receives
// (must be in its MCP_RESOURCE_SERVER_RESOURCE_URI list, k8s/02-configmap.yaml).
const GW_DOOR = process.env.PF_GW_OBO_DOOR_URL || 'https://mcpgw.ai-demo.ping-devops.com/testobo/mcp';
const GW_RESOURCE = process.env.PF_GW_OBO_RESOURCE || 'mcp-resource-server.ping.demo';
const GW_CLIENT_ID = 'privilege-gw-obo';
const GW_VAULT_SECRET = 'PF_GW_OBO_CLIENT_SECRET';
const GW_ATM_ID = 'privilegeGwOboAtm';
const GW_KEY_ID = `${SIGNING_KEY_ID}-gwobo`;
const GW_POLICY_ID = 'aiDemoPfGwOboPolicy';
const GW_SP_ID = 'aiDemoPfGwOboSp';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';

const SCOPES_TABLE = (name, values) => ({
    name: 'Scope Assertion Mappings',
    rows: values.map((value) => ({ fields: [{ name: 'Scope', value }, { name: 'Assertion', value }] })),
});

const log = (message) => console.log(`[pf-obo] ${message}`);

// Same vault access as provision-cross-domain-exchange.js.
const VAULT_JS = path.join(MAIN, 'demo_api_server', 'scripts', 'vault.js');
function vault(args, input) {
    const envText = fs.readFileSync(path.join(MAIN, 'demo_api_server', '.env'), 'utf8');
    const password = (envText.match(/^VAULT_PASSWORD=(.*)$/m) || [])[1]?.trim().replace(/^"|"$/g, '');
    return execFileSync(process.execPath, [VAULT_JS, ...args], {
        env: { ...process.env, VAULT_PASSWORD: password, VAULT_PATH: path.join(MAIN, 'secrets.vault') },
        input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    }).trim().split('\n');
}

function adminPassword() {
    if (process.env.PINGFEDERATE_ADMIN_PASSWORD) return process.env.PINGFEDERATE_ADMIN_PASSWORD;
    const lines = execFileSync('docker', ['inspect', CONTAINER, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' }).split('\n');
    const line = lines.find((entry) => entry.startsWith('PING_IDENTITY_PASSWORD='));
    if (!line) throw new Error(`PING_IDENTITY_PASSWORD is not set on ${CONTAINER}`);
    return line.slice('PING_IDENTITY_PASSWORD='.length);
}

async function main() {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const auth = 'Basic ' + Buffer.from(`administrator:${adminPassword()}`).toString('base64');
    const api = async (method, resource, body) => {
        const response = await fetch(`${PF_BASE}/${resource}`, {
            method,
            headers: { Authorization: auth, 'X-XSRF-Header': 'x', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = (json.validationErrors || []).map((item) => item.message).join('; ') || json.message || '';
            throw new Error(`${method} ${resource} -> HTTP ${response.status} ${detail}`.trim());
        }
        return json;
    };
    const find = async (resource) => {
        try { return await api('GET', resource); } catch (error) {
            if (/HTTP 404/.test(error.message)) return null;
            throw error;
        }
    };
    const step = async (label, missing, change) => {
        if (!await missing()) return log(`${label}: already in place`);
        if (!APPLY) return log(`${label}: WOULD apply`);
        await change();
        log(`${label}: applied, readback ${await missing() ? 'MISSING' : 'ok'}`);
    };
    log(`${APPLY ? 'apply' : 'dry run'} against ${PF_BASE}`);

    for (const name of [VAULT_SECRET]) {
        await step(`vault ${name}`,
            async () => !vault(['list']).includes(name),
            async () => { vault(['set', name], crypto.randomBytes(32).toString('hex')); });
    }

    await step(`scopes ${SCOPES.join(',')}`,
        async () => {
            const settings = await api('GET', 'oauth/authServerSettings');
            return !SCOPES.every((name) => (settings.scopes || []).some((scope) => scope.name === name));
        },
        async () => {
            const settings = await api('GET', 'oauth/authServerSettings');
            const add = SCOPES
                .filter((name) => !(settings.scopes || []).some((scope) => scope.name === name))
                .map((name) => ({ name, description: `OBO demo scope ${name}`, dynamic: false }));
            await api('PUT', 'oauth/authServerSettings', { ...settings, scopes: [...(settings.scopes || []), ...add] });
        });

    // Extend the shared JWT subject processor (additive) so it accepts the demo user's
    // id token: the token's iss is the PF PUBLIC host (not the internal localhost issuer
    // the processor lists today) and its aud is the user sign-in client.
    const processorResource = `idp/tokenProcessors/${JWT_PROCESSOR_ID}`;
    const processorOk = (processor) => {
        const tables = processor?.configuration?.tables || [];
        const issuers = (tables.find((table) => table.name === 'Allowed Issuers')?.rows || [])
            .flatMap((row) => row.fields.filter((field) => field.name === 'Issuer').map((field) => field.value));
        const audiences = (tables.find((table) => table.name === 'Allowed Audiences')?.rows || [])
            .flatMap((row) => row.fields.filter((field) => field.name === 'Audience').map((field) => field.value));
        return issuers.includes(PF_ISSUER) && audiences.includes(USER_CLIENT_ID);
    };
    await step(`subject processor ${JWT_PROCESSOR_ID} (issuer + ${USER_CLIENT_ID} audience)`,
        async () => !processorOk(await find(processorResource)),
        async () => {
            const processor = await api('GET', processorResource);
            for (const table of processor.configuration.tables) {
                if (table.name === 'Allowed Issuers'
                    && !table.rows.some((row) => row.fields.some((field) => field.name === 'Issuer' && field.value === PF_ISSUER))) {
                    table.rows.push({ fields: [
                        { name: 'Issuer', value: PF_ISSUER },
                        { name: 'JWKS URL', value: PF_JWKS },
                        { name: 'JWKS', value: '' },
                    ], defaultRow: false });
                }
                if (table.name === 'Allowed Audiences'
                    && !table.rows.some((row) => row.fields.some((field) => field.name === 'Audience' && field.value === USER_CLIENT_ID))) {
                    table.rows.push({ fields: [{ name: 'Audience', value: USER_CLIENT_ID }], defaultRow: false });
                }
            }
            return api('PUT', processorResource, processor);
        });

    const atmResource = `oauth/accessTokenManagers/${ATM_ID}`;
    const atmOk = (atm) => {
        if (!atm) return false;
        return (atm.configuration?.fields || []).some((field) => field.name === 'Audience Claim Value' && field.value === DOOR)
            && (atm.configuration?.fields || []).some((field) => field.name === 'Active Signing Certificate Key ID' && field.value === `${SIGNING_KEY_ID}-routec`)
            && (atm.configuration?.fields || []).some((field) => field.name === 'Publish Keys to the PingFederate JWKS Endpoint' && field.value === 'true');
    };
    await step(`ATM ${ATM_ID}`,
        async () => !atmOk(await find(atmResource)),
        async () => {
            const template = await api('GET', `oauth/accessTokenManagers/${TEMPLATE_ATM}`);
            const fields = template.configuration.fields.map((field) => {
                if (field.name === 'Audience Claim Value') return { ...field, value: DOOR };
                if (field.name === 'Issuer Claim Value') return { ...field, value: PF_ISSUER };
                // Centralized signing is rejected with 422 on 13.1.3 AND its key is not
                // published to /pf/JWKS (the Privilege NHI and the gateway verify against
                // that JWKS), so sign with the shared certificate under a unique key id.
                if (field.name === 'Use Centralized Signing Key') return { ...field, value: 'false' };
                if (field.name === 'Active Signing Certificate Key ID') return { ...field, value: `${SIGNING_KEY_ID}-routec` };
                if (field.name === 'Publish Keys to the PingFederate JWKS Endpoint') return { ...field, value: 'true' };
                return field;
            });
            // The certificate rows carry (Key ID, Certificate); Key ID must be unique
            // across all ATMs ("Key ID value … is already used …", 422, live).
            const tables = template.configuration.tables.map((table) => table.name === 'Certificates'
                ? { ...table, rows: [{ fields: [{ name: 'Key ID', value: `${SIGNING_KEY_ID}-routec` }, { name: 'Certificate', value: SIGNING_KEY_ID }], defaultRow: true }] }
                : table);
            const body = {
                ...template,
                id: ATM_ID,
                name: ATM_NAME,
                // The GET readback carries a sequenceNumber that POST rejects ("already in
                // use") — omit it and let PF assign one.
                sequenceNumber: undefined,
                configuration: { ...template.configuration, tables, fields },
            };
            delete body.sequenceNumber;
            return (await find(atmResource)) ? api('PUT', atmResource, body) : api('POST', 'oauth/accessTokenManagers', body);
        });

    const policyResource = `oauth/tokenExchange/processor/policies/${POLICY_ID}`;
    const policyOk = (policy) => policy && policy.actorTokenRequired === false
        && (policy.processorMappings || []).some((mapping) => mapping.subjectTokenType === REFRESH_TOKEN_TYPE
            && mapping.subjectTokenProcessor?.id === JWT_PROCESSOR_ID);
    const POLICY = {
        id: POLICY_ID,
        name: POLICY_NAME,
        actorTokenRequired: false,
        attributeContract: {
            coreAttributes: [{ name: 'subject' }],
            extendedAttributes: [{ name: 'scope' }, { name: 'client_id' }],
        },
        processorMappings: [{
            attributeSources: [],
            attributeContractFulfillment: {
                // The JWT processor exposes sub (not Username).
                subject: { source: { type: 'SUBJECT_TOKEN' }, value: 'sub' },
                scope: { source: { type: 'SUBJECT_TOKEN' }, value: 'scope' },
                client_id: { source: { type: 'SUBJECT_TOKEN' }, value: 'client_id' },
            },
            issuanceCriteria: { conditionalCriteria: [] },
            subjectTokenType: REFRESH_TOKEN_TYPE,
            subjectTokenProcessor: { id: JWT_PROCESSOR_ID },
        }],
    };
    await step(`policy ${POLICY_ID}`,
        async () => !policyOk(await find(policyResource)),
        async () => (await find(policyResource)
            ? api('PUT', policyResource, POLICY)
            : api('POST', 'oauth/tokenExchange/processor/policies', POLICY)));

    // Mapping id shape: grant|policy|atm (read from the live mappings list).
    const MAPPING_ID = `urn:ietf:params:oauth:grant-type:token-exchange|${POLICY_ID}|${ATM_ID}`;
    const mappingResource = `oauth/accessTokenMappings/${MAPPING_ID.split('|').map(encodeURIComponent).join('%7C')}`;
    const mappingOk = (mapping) => mapping
        && mapping.attributeContractFulfillment?.sub?.value === 'subject'
        && mapping.attributeContractFulfillment?.act?.source?.type === 'EXPRESSION'
        && mapping.attributeContractFulfillment?.client_id?.value === 'client_id';
    const MAPPING = {
        attributeSources: [],
        attributeContractFulfillment: {
            // OBO shape: sub = the USER (from the id token), act = a JSON object naming
            // the agent, client_id = the agent's client. The cloned ATM contract (sub,
            // act, Username, scope, client_id, spiffeId) requires every extended
            // attribute to be fulfilled.
            sub: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'subject' },
            act: { source: { type: 'EXPRESSION' }, value: `#{"sub": "${AGENT_ACT}"}` },
            client_id: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'client_id' },
            scope: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'scope' },
            Username: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'subject' },
            spiffeId: { source: { type: 'EXPRESSION' }, value: '""' },
        },
        issuanceCriteria: { conditionalCriteria: [] },
        id: MAPPING_ID,
        context: {
            type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY',
            contextRef: { id: POLICY_ID, location: `${PF_BASE}/oauth/tokenExchange/processor/policies/${POLICY_ID}` },
        },
        accessTokenManagerRef: { id: ATM_ID, location: `${PF_BASE}/oauth/accessTokenManagers/${ATM_ID}` },
    };
    await step(`mapping ${MAPPING_ID}`,
        async () => !mappingOk(await find(mappingResource)),
        async () => (await find(mappingResource)
            ? api('PUT', mappingResource, MAPPING)
            : api('POST', 'oauth/accessTokenMappings', MAPPING)));

    // PingFederate validates the exchange's `audience` against a token-exchange SP
    // connection whose resourceUris contain it — without one the exchange fails with
    // invalid_target. Same shape as the cross-domain SP (aiDemoPfXdomainSp).
    const SP_ID = 'aiDemoPfPrivilegeOboSp';
    const SP = {
        type: 'SP',
        id: SP_ID,
        name: 'AI Demo PF Privilege OBO Resource',
        entityId: DOOR,
        active: true,
        loggingMode: 'STANDARD',
        virtualEntityIds: [],
        credentials: {
            certs: [],
            signingSettings: {
                signingKeyPairRef: { id: SIGNING_KEY_ID },
                algorithm: 'SHA256withRSA',
                includeCertInSignature: false,
                includeRawKeyInSignature: false,
            },
        },
        connectionTargetType: 'STANDARD',
        oauthTokenExchangeSettings: {
            resourceUris: [DOOR],
            minutesBefore: 5,
            minutesAfter: 30,
            idJagEnabled: true,
            attributeContract: {
                coreAttributes: [{ name: 'TOKEN_SUBJECT' }],
                extendedAttributes: [{ name: 'client_id' }, { name: 'scope' }],
            },
            processorPolicyMappings: [{
                attributeSources: [],
                attributeContractFulfillment: {
                    TOKEN_SUBJECT: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'subject' },
                    client_id: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'client_id' },
                    scope: { source: { type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY' }, value: 'scope' },
                },
                issuanceCriteria: { conditionalCriteria: [] },
                processorPolicyRef: { id: POLICY_ID },
            }],
        },
    };
    const spResource = `idp/spConnections/${SP_ID}`;
    const spOk = (sp) => sp && sp.active
        && (sp.oauthTokenExchangeSettings?.resourceUris || []).includes(DOOR)
        && (sp.oauthTokenExchangeSettings?.processorPolicyMappings || []).some((mapping) => mapping.processorPolicyRef?.id === POLICY_ID);
    await step(`SP connection ${SP_ID}`,
        async () => !spOk(await find(spResource)),
        async () => (await find(spResource)
            ? api('PUT', spResource, SP)
            : api('POST', 'idp/spConnections', SP)));

    // PingFederate never returns a client secret; the vault is the source of truth.
    const clientResource = `oauth/clients/${CLIENT_ID}`;
    const clientOk = (existing) => existing && existing.enabled
        && (existing.grantTypes || []).includes('TOKEN_EXCHANGE')
        && existing.tokenExchangeProcessorPolicyRef?.id === POLICY_ID
        && existing.defaultAccessTokenManagerRef?.id === ATM_ID
        && (existing.restrictedScopes || []).every((scope) => SCOPES.includes(scope));
    const clientBody = (secret) => ({
        clientId: CLIENT_ID,
        name: CLIENT_NAME,
        description: 'Privilege OBO demo client (act.sub pinned in the NHI PFtoken required claims)',
        enabled: true,
        redirectUris: [],
        grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'],
        clientAuth: { type: 'SECRET', secret },
        restrictScopes: true,
        restrictedScopes: [...SCOPES],
        tokenExchangeProcessorPolicyRef: { id: POLICY_ID },
        defaultAccessTokenManagerRef: { id: ATM_ID },
    });
    await step(`client ${CLIENT_ID}`,
        async () => !clientOk(await find(clientResource)),
        async () => {
            const secret = vault(['get', VAULT_SECRET]).pop();
            return (await find(clientResource))
                ? api('PUT', clientResource, clientBody(secret))
                : api('POST', 'oauth/clients', clientBody(secret));
        });

    // ---- Gateway OBO: the Privilege gateway exchanges the agent token for the backend ----
    await step(`vault ${GW_VAULT_SECRET}`,
        async () => !vault(['list']).includes(GW_VAULT_SECRET),
        async () => { vault(['set', GW_VAULT_SECRET], crypto.randomBytes(32).toString('hex')); });

    const hasAudience = (processor, value) => ((processor?.configuration?.tables || [])
        .find((table) => table.name === 'Allowed Audiences')?.rows || [])
        .some((row) => row.fields.some((field) => field.name === 'Audience' && field.value === value));
    await step(`subject processor ${JWT_PROCESSOR_ID} (+ ${GW_DOOR} audience)`,
        async () => !hasAudience(await find(processorResource), GW_DOOR),
        async () => {
            const processor = await api('GET', processorResource);
            processor.configuration.tables.find((table) => table.name === 'Allowed Audiences')
                .rows.push({ fields: [{ name: 'Audience', value: GW_DOOR }], defaultRow: false });
            return api('PUT', processorResource, processor);
        });

    const gwAtmResource = `oauth/accessTokenManagers/${GW_ATM_ID}`;
    const gwAtmOk = (atm) => atm
        && (atm.configuration?.fields || []).some((field) => field.name === 'Audience Claim Value' && field.value === GW_RESOURCE)
        && (atm.configuration?.fields || []).some((field) => field.name === 'Active Signing Certificate Key ID' && field.value === GW_KEY_ID)
        && (atm.configuration?.fields || []).some((field) => field.name === 'Publish Keys to the PingFederate JWKS Endpoint' && field.value === 'true');
    await step(`ATM ${GW_ATM_ID}`,
        async () => !gwAtmOk(await find(gwAtmResource)),
        async () => {
            // Same signing rules as routeCTestAtm above: per-ATM certificate, unique key
            // id, published to /pf/JWKS (the backend verifies against that JWKS).
            const template = await api('GET', `oauth/accessTokenManagers/${TEMPLATE_ATM}`);
            const fields = template.configuration.fields.map((field) => {
                if (field.name === 'Audience Claim Value') return { ...field, value: GW_RESOURCE };
                if (field.name === 'Issuer Claim Value') return { ...field, value: PF_ISSUER };
                if (field.name === 'Use Centralized Signing Key') return { ...field, value: 'false' };
                if (field.name === 'Active Signing Certificate Key ID') return { ...field, value: GW_KEY_ID };
                if (field.name === 'Publish Keys to the PingFederate JWKS Endpoint') return { ...field, value: 'true' };
                return field;
            });
            const tables = template.configuration.tables.map((table) => table.name === 'Certificates'
                ? { ...table, rows: [{ fields: [{ name: 'Key ID', value: GW_KEY_ID }, { name: 'Certificate', value: SIGNING_KEY_ID }], defaultRow: true }] }
                : table);
            const body = { ...template, id: GW_ATM_ID, name: 'Privilege gateway OBO backend tokens', configuration: { ...template.configuration, tables, fields } };
            delete body.sequenceNumber;
            return (await find(gwAtmResource)) ? api('PUT', gwAtmResource, body) : api('POST', 'oauth/accessTokenManagers', body);
        });

    // Same contract as POLICY above; only the subject token type differs: the gateway
    // presents the agent's ACCESS token, not the user's id token.
    const gwPolicyResource = `oauth/tokenExchange/processor/policies/${GW_POLICY_ID}`;
    const GW_POLICY = {
        ...POLICY,
        id: GW_POLICY_ID,
        name: 'AI Demo PF Privilege gateway OBO Exchange',
        processorMappings: [{ ...POLICY.processorMappings[0], subjectTokenType: ACCESS_TOKEN_TYPE }],
    };
    await step(`policy ${GW_POLICY_ID}`,
        async () => {
            const policy = await find(gwPolicyResource);
            return !(policy && (policy.processorMappings || []).some((mapping) => mapping.subjectTokenType === ACCESS_TOKEN_TYPE
                && mapping.subjectTokenProcessor?.id === JWT_PROCESSOR_ID));
        },
        async () => (await find(gwPolicyResource)
            ? api('PUT', gwPolicyResource, GW_POLICY)
            : api('POST', 'oauth/tokenExchange/processor/policies', GW_POLICY)));

    const GW_MAPPING_ID = `urn:ietf:params:oauth:grant-type:token-exchange|${GW_POLICY_ID}|${GW_ATM_ID}`;
    const gwMappingResource = `oauth/accessTokenMappings/${GW_MAPPING_ID.split('|').map(encodeURIComponent).join('%7C')}`;
    const GW_MAPPING = {
        ...MAPPING,
        // act names the gateway, the exchanging party; client_id stays the agent's.
        attributeContractFulfillment: {
            ...MAPPING.attributeContractFulfillment,
            act: { source: { type: 'EXPRESSION' }, value: `#{"sub": "${GW_CLIENT_ID}"}` },
        },
        id: GW_MAPPING_ID,
        context: {
            type: 'TOKEN_EXCHANGE_PROCESSOR_POLICY',
            contextRef: { id: GW_POLICY_ID, location: `${PF_BASE}/oauth/tokenExchange/processor/policies/${GW_POLICY_ID}` },
        },
        accessTokenManagerRef: { id: GW_ATM_ID, location: `${PF_BASE}/oauth/accessTokenManagers/${GW_ATM_ID}` },
    };
    await step(`mapping ${GW_MAPPING_ID}`,
        async () => !mappingOk(await find(gwMappingResource)),
        async () => (await find(gwMappingResource)
            ? api('PUT', gwMappingResource, GW_MAPPING)
            : api('POST', 'oauth/accessTokenMappings', GW_MAPPING)));

    const GW_SP = {
        ...SP,
        id: GW_SP_ID,
        name: 'AI Demo PF Privilege gateway OBO backend',
        entityId: GW_RESOURCE,
        oauthTokenExchangeSettings: {
            ...SP.oauthTokenExchangeSettings,
            resourceUris: [GW_RESOURCE],
            processorPolicyMappings: [{ ...SP.oauthTokenExchangeSettings.processorPolicyMappings[0], processorPolicyRef: { id: GW_POLICY_ID } }],
        },
    };
    const gwSpResource = `idp/spConnections/${GW_SP_ID}`;
    await step(`SP connection ${GW_SP_ID}`,
        async () => {
            const sp = await find(gwSpResource);
            return !(sp && sp.active && (sp.oauthTokenExchangeSettings?.resourceUris || []).includes(GW_RESOURCE)
                && (sp.oauthTokenExchangeSettings?.processorPolicyMappings || []).some((mapping) => mapping.processorPolicyRef?.id === GW_POLICY_ID));
        },
        async () => (await find(gwSpResource)
            ? api('PUT', gwSpResource, GW_SP)
            : api('POST', 'idp/spConnections', GW_SP)));

    const gwClientResource = `oauth/clients/${GW_CLIENT_ID}`;
    const gwClientBody = (secret) => ({
        ...clientBody(secret),
        clientId: GW_CLIENT_ID,
        name: 'Privilege gateway OBO exchanger',
        description: 'The Privilege gateway exchanges agent tokens for the pftoken-rs backend (Auth Mode OBO)',
        grantTypes: ['TOKEN_EXCHANGE'],
        tokenExchangeProcessorPolicyRef: { id: GW_POLICY_ID },
        defaultAccessTokenManagerRef: { id: GW_ATM_ID },
    });
    await step(`client ${GW_CLIENT_ID}`,
        async () => {
            const existing = await find(gwClientResource);
            return !(existing && existing.enabled
                && (existing.grantTypes || []).includes('TOKEN_EXCHANGE')
                && existing.tokenExchangeProcessorPolicyRef?.id === GW_POLICY_ID
                && existing.defaultAccessTokenManagerRef?.id === GW_ATM_ID);
        },
        async () => {
            const secret = vault(['get', GW_VAULT_SECRET]).pop();
            return (await find(gwClientResource))
                ? api('PUT', gwClientResource, gwClientBody(secret))
                : api('POST', 'oauth/clients', gwClientBody(secret));
        });

    log(APPLY ? 'done' : 'dry run only - re-run with --apply');
}

main().catch((error) => { console.error(`[pf-obo] failed: ${error.message}`); process.exit(1); });
