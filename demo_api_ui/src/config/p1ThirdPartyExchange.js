/* eslint-disable no-template-curly-in-string -- SpEL expressions are shown as text */
// /p1-third-party-exchange: PingOne token exchange (RFC 8693) accepting third-party signed JWTs as subject/actor tokens.
// Sources: Ping's UAT guide "Token Exchange to support third-party signed JWTs as subject and actor tokens" (23 Oct 2026,
// Ping staff and selected customers; feature-flagged; this page calls the guide GUIDE) and the "Token claims from Auth0,
// Okta, Microsoft, RFC9068, and PingOne" comparison sheets (public vendor sample tokens; SAMPLE). The page itself calls nothing:
// it is a mock. Its refusal wording and settings behaviour were MEASURED live against PingOne on 2026-10-27 (see MEASURED below). Every issuer, client id, user id and host is a placeholder; real tenant ids from the guide are NOT copied.
import { wrapMessages } from './sequenceWrap';

export const EVIDENCE = {
  measured: { label: 'MEASURED', note: 'Run live against a PingOne environment (North America) on 2026-10-27, with a trusted issuer whose key we generated ourselves. Exact error text is what PingOne returned.' },
  guide: { label: 'GUIDE', note: "Stated in Ping's UAT guide (23 Oct 2026)." },
  sample: { label: 'SAMPLE', note: "A vendor's published sample token or the comparison sheet. Ids, hosts and times are placeholders." },
  derived: { label: 'OUR CHOICE', note: 'Our illustration of how a mapping could look. Not from the guide.' },
  unverified: { label: 'UNVERIFIED', note: 'Not stated in the guide or not captured (the guide shows its token requests as images). Check before quoting.' },
};

export const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';
export const JWT_TYPE = 'urn:ietf:params:oauth:token-type:jwt';
export const ACCESS_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
export const P1_ISSUER = 'https://auth.pingone.example/00000000-0000-0000-0000-000000000001/as';
export const P1_TOKEN_URL = `${P1_ISSUER}/token`;
export const RESOURCE_AUD = 'https://api.example.com/address';
export const RESOURCE_SCOPE = 'a.read.all';
export const APP_CLIENT_ID = '11111111-1111-1111-1111-111111111111';
export const USER_ID = '22222222-2222-2222-2222-222222222222';

/** Unsigned, labelled mock JWT for display: header.payload.mock-signature. Never verifiable. */
export function mockJwt(claims) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256', typ: 'JWT', kid: 'mock-key' })}.${b64(claims)}.MOCK-SIGNATURE-NOT-VALID`;
}

export function subjectClaims(now) {
  return {
    client_id: APP_CLIENT_ID, iss: P1_ISSUER, jti: 'mock-jti-subject', iat: now - 120, exp: now + 3480,
    aud: ['https://api.pingone.example'], scope: 'openid', sub: USER_ID, sid: 'mock-session-id', auth_time: now - 120,
    acr: 'Single_Factor', env: '00000000-0000-0000-0000-000000000001', org: '00000000-0000-0000-0000-0000000000aa',
  };
}

// Each vendor: the issuer string its token carries, which time claims it has, and a claims builder. A claim a vendor
// does not issue is simply absent (that is what the nbf/iat toggles expose).
export const VENDORS = [
  {
    id: 'pf-cc', name: 'PingFederate: client credentials', evidence: 'guide', issuer: 'https://pf.example.com:9031',
    note: 'Token 2 of the guide\'s sample A. A machine identity: the agent app\'s own PingFederate token. No iat or nbf, only exp.',
    claims: (now) => ({ jatm_scope: '', jatm_client_id: 'cc_client', iss: 'https://pf.example.com:9031', aud: 'cc_client', jti: 'mock-jti-pf-cc', sub: 'cc_client', subj: 'PF admin maps what PF admin wants', exp: now + 3600 }),
    mappings: [
      { id: 'act', label: 'act.sub from the actor token sub', target: 'act', source: 'sub', wrap: 'act', evidence: 'measured', note: "Guide sample A, reproduced live. Expression on the resource: ${{'sub': #root.context.requestData.actorToken.sub}}. A client-credentials token with no actor gets act.sub null, so expect that on tokens issued without an actor." },
    ],
  },
  {
    id: 'pf-oidc', name: 'PingFederate: ID token', evidence: 'guide', issuer: 'https://pf.example.com:9031',
    note: 'Token 2 of the guide\'s sample B. A user ID token carrying a custom securityLevel claim.',
    claims: (now) => ({ sub: 'jsmith', aud: 'oic_client', jti: 'mock-jti-pf-id', iss: 'https://pf.example.com:9031', iat: now - 60, exp: now + 3540, sid: 'mock-sid', amr: ['oidcPolicy'], auth_time: now - 60, acr: 'oidcPolicy', securityLevel: 'Class 3' }),
    mappings: [
      { id: 'sec', label: 'security from the securityLevel claim', target: 'security', source: 'securityLevel', evidence: 'measured', note: 'Guide sample B, reproduced live. Expression: ${#root.context.requestData.actorToken.securityLevel}. If the actor token has no such claim, PingOne leaves the attribute out and still issues the token (measured).' },
    ],
  },
  {
    id: 'p1', name: 'PingOne (another environment)', evidence: 'sample', issuer: 'https://auth.pingone.example/00000000-0000-0000-0000-000000000002/as',
    note: 'The comparison sheet column for a PingOne token from a different environment. Claim set taken from the sheet and the guide\'s PingOne token 1.',
    claims: (now) => ({ iss: 'https://auth.pingone.example/00000000-0000-0000-0000-000000000002/as', sub: 'mock-user-in-other-env', aud: ['https://api.other-env.example'], client_id: 'mock-client-other-env', iat: now - 60, exp: now + 3540, jti: 'mock-jti-p1', auth_time: now - 60, acr: 'Single_Factor', scope: 'openid', 'p1.userId': 'mock-user-in-other-env' }),
    mappings: [{ id: 'act', label: 'act.sub from client_id', target: 'act', source: 'client_id', wrap: 'act', evidence: 'derived', note: 'Our illustration: name the calling application of the other environment.' }],
  },
  {
    id: 'okta', name: 'Okta', evidence: 'sample', issuer: 'https://example.okta.com/oauth2/aus1example',
    note: 'Okta access token. Application id is cid, scopes are scp, user id is uid. Has no nbf.',
    claims: (now) => ({ ver: 1, jti: 'AT.mock-jti-okta', iss: 'https://example.okta.com/oauth2/aus1example', aud: 'https://api.example.com', sub: '00uexampleuser', iat: now - 60, exp: now + 3540, cid: '0oaexampleapp', uid: '00uexampleuser', scp: ['openid', 'email', 'flights', 'custom'], auth_time: now - 120, custom_claim: 'CustomValue' }),
    mappings: [{ id: 'act', label: 'act.sub from cid', target: 'act', source: 'cid', wrap: 'act', evidence: 'derived', note: 'Our illustration: cid is the calling Okta application.' }],
  },
  {
    id: 'auth0', name: 'Auth0', evidence: 'sample', issuer: 'https://my-domain.auth0.com/',
    note: 'Auth0 access token (its default profile). Application id is azp, no jti, no auth_time. Has no nbf.',
    claims: (now) => ({ iss: 'https://my-domain.auth0.com/', sub: 'auth0|123456', aud: ['https://example.com/health-api', 'https://my-domain.auth0.com/userinfo'], azp: 'my_client_id', iat: now - 60, exp: now + 3540, scope: 'openid profile read:patients read:admin', my_custom_claim: 'my_custom_value' }),
    mappings: [{ id: 'act', label: 'act.sub from azp', target: 'act', source: 'azp', wrap: 'act', evidence: 'derived', note: 'Our illustration: azp is the authorized party, the calling application.' }],
  },
  {
    id: 'rfc9068', name: 'RFC 9068 (and Auth0 RFC 9068 profile)', evidence: 'sample', issuer: 'https://authorization-server.example.com/',
    note: 'The standard JWT access-token profile. Required: iss, exp, aud, sub, client_id, iat, jti. Auth0 can issue this shape too.',
    claims: (now) => ({ iss: 'https://authorization-server.example.com/', sub: '5ba552d67', aud: 'https://rs.example.com/', exp: now + 3600, iat: now - 60, jti: 'mock-jti-rfc9068', client_id: 's6BhdRkqt3', scope: 'openid profile reademail' }),
    mappings: [{ id: 'act', label: 'act.sub from client_id', target: 'act', source: 'client_id', wrap: 'act', evidence: 'derived', note: 'Our illustration: client_id is required by RFC 9068, so it is always there.' }],
  },
  {
    id: 'ms1', name: 'Microsoft v1.0', evidence: 'sample', issuer: 'https://sts.windows.net/aaaaaaaa-0000-0000-0000-000000000001/',
    note: 'Entra ID v1.0 access token. Application id is appid, user object id is oid, jti is uti. Has iat, nbf and exp.',
    claims: (now) => ({ aud: 'api://example-app', iss: 'https://sts.windows.net/aaaaaaaa-0000-0000-0000-000000000001/', iat: now - 60, nbf: now - 60, exp: now + 3540, acr: '1', aio: '<opaque>', amr: ['wia'], appid: 'bbbbbbbb-0000-0000-0000-000000000002', appidacr: '0', email: 'abe@example.com', family_name: 'Lincoln', given_name: 'Abe', idp: 'https://sts.windows.net/aaaaaaaa-0000-0000-0000-000000000003/', name: 'abeli', oid: 'cccccccc-0000-0000-0000-000000000004', scp: 'user_impersonation', sub: 'mock-sub-ms1', tid: 'aaaaaaaa-0000-0000-0000-000000000001', uti: 'mock-uti-ms1', ver: '1.0' }),
    mappings: [{ id: 'act', label: 'act.sub from appid', target: 'act', source: 'appid', wrap: 'act', evidence: 'derived', note: 'Our illustration: appid is the calling application.' }],
  },
  {
    id: 'ms2', name: 'Microsoft v2.0', evidence: 'sample', issuer: 'https://login.microsoftonline.com/aaaaaaaa-0000-0000-0000-000000000001/v2.0',
    note: 'Entra ID v2.0 access token. Application id is azp, no amr, jti is uti. Has iat, nbf and exp.',
    claims: (now) => ({ aud: 'dddddddd-0000-0000-0000-000000000005', iss: 'https://login.microsoftonline.com/aaaaaaaa-0000-0000-0000-000000000001/v2.0', iat: now - 60, nbf: now - 60, exp: now + 3540, aio: '<opaque>', azp: 'dddddddd-0000-0000-0000-000000000005', azpacr: '0', name: 'Abe Lincoln', oid: 'eeeeeeee-0000-0000-0000-000000000006', preferred_username: 'abe@example.com', scp: 'access_as_user', sub: 'mock-sub-ms2', tid: 'aaaaaaaa-0000-0000-0000-000000000001', uti: 'mock-uti-ms2', ver: '2.0' }),
    mappings: [{ id: 'act', label: 'act.sub from azp', target: 'act', source: 'azp', wrap: 'act', evidence: 'derived', note: 'Our illustration: azp is the calling application.' }],
  },
];

// Trusted issuer fields from the guide's admin API sample. maxFutureValidity exists but the guide does not say how it acts.
// clockSkew (seconds, MEASURED: PingOne rejects more than 60) loosens exp and nbf. maxFutureValidity (seconds, 0 = no limit,
// MEASURED) refuses an exp that is further ahead than that. Both are in the guide's API sample (value 0) but unexplained there.
export const TRUSTED_ISSUER_DEFAULTS = { expRequired: true, iatRequired: false, nbfRequired: false, audiences: '', clockSkew: 0, maxFutureValidity: 0 };
export const MAX_CLOCK_SKEW = 60;

export const TOKEN_STATES = [
  { id: 'valid', label: 'Valid' },
  { id: 'expired', label: 'Expired' },
  { id: 'wrong-issuer', label: 'Issuer not trusted' },
  { id: 'bad-signature', label: 'Bad signature' },
];

const audList = (aud) => (aud === undefined ? [] : Array.isArray(aud) ? aud : [aud]);

/** Apply a token state to a vendor's claims. Returns the claims the exchange will see. */
export function stateClaims(vendor, state, now) {
  const c = vendor.claims(now);
  if (state === 'expired') return { ...c, ...(c.exp !== undefined ? { exp: now - 600 } : {}) };
  if (state === 'wrong-issuer') return { ...c, iss: 'https://not-trusted.example.org/' };
  return c;
}

const P1_ERROR_PREFIX = 'The request could not be completed. The request was malformed or invalid.: ';

/**
 * Mock of PingOne's checks on a third-party JWT used as actor token. Every `message` below is the text PingOne returned
 * when we ran the same case live on 2026-10-27 (HTTP 400, error invalid_request). The ORDER in which PingOne evaluates
 * the checks is NOT known: when several fail at once, PingOne may report a different one first.
 */
export function validateExchange({ vendor, state, settings, assigned, now }) {
  const claims = stateClaims(vendor, state, now);
  const aud = audList(claims.aud);
  const wanted = settings.audiences.split(',').map((s) => s.trim()).filter(Boolean);
  const skew = Math.min(Math.max(Number(settings.clockSkew) || 0, 0), MAX_CLOCK_SKEW);
  const maxFuture = Math.max(Number(settings.maxFutureValidity) || 0, 0);
  const checks = [
    { id: 'assigned', label: 'Trusted issuer is assigned to the application', ok: assigned, detail: assigned ? 'assigned' : 'not assigned to the calling application', message: 'The token issuer does not match any Trusted Issuer for the requesting application' },
    { id: 'issuer', label: 'iss equals the trusted issuer', ok: claims.iss === vendor.issuer, detail: `token iss: ${claims.iss}`, message: 'The token issuer does not match any Trusted Issuer assigned to the application' },
    { id: 'signature', label: 'Signature verifies against the issuer JWKS', ok: state !== 'bad-signature', detail: state === 'bad-signature' ? 'signature does not match any key in the JWKS' : 'verified against JWKS (mock)', message: 'JWT signature verification failed' },
    { id: 'exp', label: settings.expRequired ? 'exp present and not past' : 'exp not required', ok: claims.exp === undefined ? !settings.expRequired : claims.exp > now - skew, detail: claims.exp === undefined ? 'token has no exp' : claims.exp > now - skew ? 'in the future' : 'in the past', message: claims.exp === undefined ? 'Missing exp claim; the Trusted Issuer requires an expiration time' : 'The provided JWT has expired' },
    { id: 'maxfuture', label: maxFuture ? `exp no more than ${maxFuture}s ahead` : 'maximum future validity off', ok: !maxFuture || claims.exp === undefined || claims.exp - now <= maxFuture, detail: claims.exp === undefined ? 'no exp' : `exp is ${claims.exp - now}s ahead`, message: 'The exp claim exceeds the maximum allowed future validity' },
    { id: 'iat', label: settings.iatRequired ? 'iat present' : 'iat not required', ok: !settings.iatRequired || claims.iat !== undefined, detail: claims.iat === undefined ? 'token has no iat' : 'present', message: 'Missing iat claim; the Trusted Issuer requires an issued-at time' },
    { id: 'nbf', label: settings.nbfRequired ? 'nbf present and reached' : 'nbf not required', ok: claims.nbf === undefined ? !settings.nbfRequired : claims.nbf <= now + skew, detail: claims.nbf === undefined ? 'token has no nbf' : 'present', message: claims.nbf === undefined ? 'Missing nbf claim; the Trusted Issuer requires a not-before time' : 'The nbf claim is in the future beyond the allowed clock skew' },
    { id: 'aud', label: wanted.length ? 'aud has one of the trusted audiences' : 'Trusted audiences blank: any aud accepted', ok: !wanted.length || aud.some((a) => wanted.includes(a)), detail: `token aud: ${aud.length ? aud.join(', ') : 'none'}`, message: "None of the token's aud values match the Trusted Issuer's configured audiences" },
  ];
  const failed = checks.find((c) => !c.ok);
  return { claims, checks, ok: !failed, failed, error: failed ? { status: 400, error: 'invalid_request', error_description: P1_ERROR_PREFIX + failed.message } : null };
}

/** Run a mapping against the actor token claims. A source claim the vendor does not issue adds nothing. */
export function applyMapping(mapping, actorClaims) {
  const present = Object.prototype.hasOwnProperty.call(actorClaims, mapping.source);
  if (!present) return { present: false, claim: null };
  const v = actorClaims[mapping.source];
  return { present: true, claim: { [mapping.target]: mapping.wrap === 'act' ? { sub: v } : v } };
}

export function resultClaims(subject, mapped, now) {
  return {
    client_id: subject.client_id, iss: P1_ISSUER, jti: 'mock-jti-result', iat: now, exp: now + 3600, aud: [RESOURCE_AUD],
    scope: RESOURCE_SCOPE, sub: subject.sub, sid: subject.sid, auth_time: subject.auth_time, acr: subject.acr,
    ...(mapped?.claim || {}), env: subject.env, org: subject.org,
  };
}

export function requestText() {
  return [
    `POST ${P1_TOKEN_URL}`,
    'Content-Type: application/x-www-form-urlencoded',
    '',
    `grant_type=${GRANT_TYPE}`,
    'subject_token=<PingOne access token>',
    `subject_token_type=${ACCESS_TYPE}`,
    'actor_token=<third-party JWT>',
    `actor_token_type=${JWT_TYPE}`,
    `scope=${RESOURCE_SCOPE}`,
    '(client authentication: the application\'s client id and secret, HTTP Basic, as for any PingOne token request)',
  ].join('\n');
}

export function exchangeDiagram(vendor, run) {
  const ok = run.ok;
  const rows = [
    'sequenceDiagram',
    '    autonumber',
    '    participant A as Application\\nOIDC client',
    `    participant V as ${vendor.name.split(' (')[0]}\\nthird-party issuer`,
    '    participant P as PingOne\\ntoken endpoint',
    '    participant R as Custom resource\\nattribute mapping',
    '    rect rgb(255,235,222)',
    '    Note over A,V: 1 Two tokens, two issuers',
    '    A->>P: Authorization code flow, PingOne access token (subject)',
    '    A->>V: Get a token from the third-party issuer (actor)',
    '    end',
    '    rect rgb(218,240,240)',
    '    Note over A,P: 2 Exchange',
    '    A->>P: Token exchange: subject, actor, actor_token_type jwt',
    '    P->>V: Fetch the trusted issuer JWKS to verify the actor token',
    ok ? '    P->>P: Trusted issuer, assignment, exp, iat, nbf and aud all pass' : `    P-->>A: HTTP 400 invalid_request: ${run.failed.message}`,
    '    end',
    ...(ok ? [
      '    rect rgb(225,229,238)',
      '    Note over P,R: 3 Map and issue',
      '    P->>R: Read the resource attribute mapping for the scope',
      '    R-->>P: Claims from the actor token, as expressions',
      '    P-->>A: Access token for the resource, with the mapped claims',
      '    end',
    ] : []),
  ];
  const payloads = [
    `Authorization code flow\nSubject token (PingOne, user ${USER_ID})`,
    `${vendor.name}\n${vendor.issuer}\nThe token is shown decoded on the page.`,
    requestText(),
    `GET <JWKS URL of the trusted issuer>\nkeys for ${vendor.issuer}`,
    ok ? 'Checks passed:\n' + run.checks.map((c) => `- ${c.label}`).join('\n') : `HTTP 400 invalid_request\n${run.error.error_description}`,
    ...(ok ? [
      `Custom resource ${RESOURCE_AUD}\nattribute mapping defined on the resource`,
      'Mapped from the actor token',
      `HTTP 200\naccess_token (JWT), token_type Bearer, issued_token_type ${ACCESS_TYPE}`,
    ] : []),
  ];
  return { source: wrapMessages(rows.join('\n') + '\n'), payloads };
}

export const DIAGRAM_LANES = { A: 'agent', V: 'bff', P: 'pingone', R: 'api' };
export const DIAGRAM_DETAILS = {
  A: 'The application that holds a PingOne user token and a token from another issuer, and asks PingOne to combine them.',
  V: 'The third-party issuer (PingFederate, Okta, Auth0, Microsoft, another PingOne environment). PingOne only needs its issuer string and its JWKS.',
  P: 'PingOne as authorization server. Checks the trusted issuer, its assignment to the application, and the token checks (exp, iat, nbf, audience).',
  R: 'A custom resource in PingOne. Its attribute mapping pulls claims out of the subject and actor tokens into the issued access token.',
};

export const STEPS = [
  { n: 1, title: 'Define a trusted issuer', body: 'Name, issuer, and either a JWKS URL or the JWKS itself. Optional audience list: blank accepts any aud. Per-issuer switches say whether exp, iat and nbf must be present.', where: '/trustedIssuers', evidence: 'guide' },
  { n: 2, title: 'Assign it to an application', body: 'Only OIDC-based, non-worker applications that may use the token exchange grant. Assignments to AI agents are marked coming soon.', where: '/applications/<appId>/trustedIssuerAssignments', evidence: 'guide' },
  { n: 3, title: 'Map attributes on the custom resource', body: 'An existing capability: an expression on the resource that is the audience of the new token reads a claim from the subject or actor token. The guide shows act from the actor sub and security from securityLevel.', where: 'custom resource, attribute mapping', evidence: 'guide' },
  { n: 4, title: 'Send the token exchange', body: 'Same grant as today. The subject_token_type or actor_token_type is urn:ietf:params:oauth:token-type:jwt for the third-party token.', where: 'POST /as/token', evidence: 'guide' },
];

export const API_SAMPLES = {
  trustedIssuer: { name: 'Example', issuer: 'https://issuer.example.com', expRequired: true, iatRequired: false, nbfRequired: false, audiences: ['one', 'two'], jwksUrl: 'https://issuer.example.com/jwks' },
  assignment: { trustedIssuer: { id: '<trusted issuer id>' } },
};

export const ADMIN_FACTS = [
  ['Permissions: trusted issuers', 'trustedIssuers:create|read|update|delete:trustedIssuer. Create, update, delete: Environment Admin. Read: also Client Application Developer, Application Owner, Configuration Read Only.'],
  ['Permissions: assignments', 'applications:create|read|update|delete:trustedIssuerAssignment, same role split.'],
  ['Audit and webhook events', 'Trusted Issuer and Trusted Issuer Assignment, each with Created, Read, Update, Delete (eight events).'],
  ['License packages (any one)', 'TRIAL, ENHANCED TRIAL, AGENT IAM CORE, WORKFORCE PLUS, WORKFORCE PREMIUM, CIAM PLUS, CIAM PASSWORDLESS, CIAM PREMIUM. Four internal packages also have it.'],
  ['Measured limits (2026-10-27)', 'clockSkew is in seconds and PingOne rejects more than 60 (it loosens exp and nbf). maxFutureValidity is in seconds, 0 means no limit, and refuses an exp further ahead than that. Inline JWKS is the jwks field, a JSON string.'],
  ['Coming soon (per the guide)', 'Trusted issuer assignments to AI agents, and configuration management and promotion.'],
];

export const NOT_SHOWN = [
  'Third-party token as the SUBJECT token. The guide says it is accepted, but its two samples only use a third-party actor token, so the page does not guess what the issued sub becomes.',
  'The order PingOne evaluates the checks in. Each refusal text is real, but when two things are wrong at once PingOne may name a different one first. We tested one fault at a time.',
  'A third-party JWT as the SUBJECT token. PingOne accepts it (measured), and you can map its claims with subjectToken, but the issued token then has no sub of its own. The page simulates the actor case only.',
  'A signed-in USER as the subject. Our live runs used a client-credentials PingOne access token as the subject, because a user sign-in needs a browser.',
  'The feature flag name. The guide gives none; the flag was on in the environment we tested.',
];

// Comparison sheet (claims each issuer puts in its access token). null = "Not included" / "Not defined" on the sheet.
export const COMPARE_COLUMNS = ['PingOne', 'RFC 9068', 'Auth0 (RFC 9068)', 'Auth0', 'Okta', 'Microsoft v1.0', 'Microsoft v2.0'];
export const COMPARE_ROWS = [
  ['Issuer', 'iss', 'iss (Required)', 'iss', 'iss', 'iss', 'iss', 'iss'],
  ['Expiry', 'exp', 'exp (Required)', 'exp', 'exp', 'exp', 'exp', 'exp'],
  ['Audience', 'aud', 'aud (Required)', 'aud', 'aud', null, 'aud', 'aud'],
  ['Subject', 'sub', 'sub (Required)', 'sub', 'sub', 'sub (in sample)', 'sub', 'sub'],
  ['Client / app id', 'client_id', 'client_id (Required)', 'client_id', 'azp', 'cid', 'appid', 'azp'],
  ['Issued at', 'iat', 'iat (Required)', 'iat', 'iat', 'iat', 'iat (stands in for auth_time)', 'iat (stands in for auth_time)'],
  ['Token id', 'jti', 'jti (Required)', 'jti', null, 'jti', 'uti', 'uti'],
  ['Authentication time', 'auth_time', 'auth_time (Optional)', null, null, 'auth_time', 'iat', 'iat'],
  ['acr', 'acr', 'acr (Optional)', null, null, null, 'acrs', 'acr'],
  ['amr', null, 'amr (Optional)', null, null, null, 'amr', null],
  ['Scope', 'scope', 'scope (Conditional)', 'scope', 'scope', 'scp', 'scp', 'scp'],
  ['User id', 'p1.userId', null, null, null, 'uid', 'oid', 'oid'],
  ['Grant type used', 'Custom?', null, null, 'gty', null, null, null],
  ['Permissions', 'PingOne AuthZ', null, 'permissions', 'permissions', null, null, null],
  ['Rich authorization (RAR)', 'Not natively', null, 'authorization_details', 'authorization_details', null, null, null],
  ['mTLS binding', 'Not natively', null, 'cnf', 'cnf', null, null, null],
  ['Identity provider', 'Custom?', null, null, null, null, 'idp', null],
  ['nbf', null, null, null, null, null, 'nbf', 'nbf'],
  ['Client auth method', 'Custom', null, null, null, null, 'appidacr', 'azpacr'],
];

// ---- Full wire log: every HTTP call, with every header, the raw body and the raw tokens (nothing abbreviated). ----
// MOCK values throughout: the client secret below is a made-up value shown on purpose (education, mock only), the JWT
// signatures are fake, and the JWKS modulus is a stand-in. Shapes follow what PingOne returned in the 2026-10-27 live run.
export const MOCK_CLIENT_SECRET = 'mock-client-secret-not-a-real-credential';
const ENV_ID = '00000000-0000-0000-0000-000000000001';
const API_BASE = `https://api.pingone.example/v1/environments/${ENV_ID}`;
const AUTH_BASE = `https://auth.pingone.example/${ENV_ID}/as`;
const IDS = { issuer: '33333333-3333-3333-3333-333333333333', resource: '44444444-4444-4444-4444-444444444444', scope: '55555555-5555-5555-5555-555555555555', app: APP_CLIENT_ID, grant: '66666666-6666-6666-6666-666666666666', assignment: '77777777-7777-7777-7777-777777777777' };
const VENDOR_TOKEN_CALL = {
  'pf-cc': { path: '/as/token.oauth2', host: 'https://pf.example.com:9031' }, 'pf-oidc': { path: '/as/token.oauth2', host: 'https://pf.example.com:9031' },
  p1: { path: '/00000000-0000-0000-0000-000000000002/as/token', host: 'https://auth.pingone.example' }, okta: { path: '/oauth2/aus1example/v1/token', host: 'https://example.okta.com' },
  auth0: { path: '/oauth/token', host: 'https://my-domain.auth0.com' }, rfc9068: { path: '/token', host: 'https://authorization-server.example.com' },
  ms1: { path: '/aaaaaaaa-0000-0000-0000-000000000001/oauth2/token', host: 'https://login.microsoftonline.com' }, ms2: { path: '/aaaaaaaa-0000-0000-0000-000000000001/oauth2/v2.0/token', host: 'https://login.microsoftonline.com' },
};
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
export const toCurl = ({ method, url, requestHeaders, requestBody }) =>
  [`curl -X ${method} ${q(url)}`, ...requestHeaders.map(([k, v]) => `  -H ${q(`${k}: ${v}`)}`), ...(requestBody ? [`  --data ${q(requestBody)}`] : [])].join(' \\\n');
const basic = (id, secret) => `Basic ${btoa(`${id}:${secret}`)}`;
const respHeaders = (type = 'application/json') => [['Content-Type', type], ['Cache-Control', 'no-store'], ['Pragma', 'no-cache'], ['X-Correlation-Id', 'mock-correlation-id-0000']];

/** The decoded payload of a JWT string. Used by tests and the page to prove a displayed token decodes. */
export function decodeJwt(token) {
  const [h, p] = token.split('.');
  const dec = (s) => JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/')));
  return { header: dec(h), payload: dec(p) };
}

export function buildWire({ vendor, run, settings, assigned, now }) {
  const subject = subjectClaims(now);
  const subjectJwt = mockJwt(subject);
  const actorJwt = mockJwt(run.claims);
  const mapped = vendor.mappings.map((m) => ({ m, r: applyMapping(m, run.claims) }));
  const issued = resultClaims(subject, run.ok ? { claim: Object.assign({}, ...mapped.map(({ r }) => r.claim || {})) } : null, now);
  const jwks = JSON.stringify({ keys: [{ kty: 'RSA', kid: 'mock-key', use: 'sig', alg: 'RS256', n: 'MOCK-MODULUS-NOT-A-REAL-KEY', e: 'AQAB' }] });
  const mgmt = [['Authorization', 'Bearer <worker token: a management token from the worker app>'], ['Content-Type', 'application/json'], ['Accept', 'application/json']];
  const wanted = settings.audiences.split(',').map((s) => s.trim()).filter(Boolean);
  const call = (n, phase, label, method, url, requestHeaders, body, status, statusText, responseBody, notes, evidence = 'measured') => {
    const requestBody = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    const item = { n, phase, label, method, url, requestHeaders, requestBody, status, statusText, responseHeaders: respHeaders(), responseBody: typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody, null, 2), notes, evidence };
    return { ...item, curl: toCurl(item) };
  };
  const setup = [
    call(1, 'setup', 'Create the trusted issuer (inline JWKS)', 'POST', `${API_BASE}/trustedIssuers`, mgmt,
      { name: `${vendor.name} (trusted)`, issuer: vendor.issuer, jwks, expRequired: settings.expRequired, iatRequired: settings.iatRequired, nbfRequired: settings.nbfRequired, clockSkew: Number(settings.clockSkew) || 0, maxFutureValidity: Number(settings.maxFutureValidity) || 0, ...(wanted.length ? { audiences: wanted } : {}) },
      201, 'Created', { id: IDS.issuer, name: `${vendor.name} (trusted)`, issuer: vendor.issuer, jwksUrl: null, expRequired: settings.expRequired, iatRequired: settings.iatRequired, nbfRequired: settings.nbfRequired, clockSkew: Number(settings.clockSkew) || 0, maxFutureValidity: Number(settings.maxFutureValidity) || 0 },
      'The field is `jwks`, a JSON string. Use `jwksUrl` instead to have PingOne fetch the keys. clockSkew is capped at 60.'),
    call(2, 'setup', 'Create the custom resource (the audience of the new token)', 'POST', `${API_BASE}/resources`, mgmt, { name: 'address-api', audience: RESOURCE_AUD, accessTokenValiditySeconds: 3600 }, 201, 'Created', { id: IDS.resource, name: 'address-api', audience: RESOURCE_AUD, accessTokenValiditySeconds: 3600 }, 'Its audience becomes the aud of the issued token.'),
    call(3, 'setup', 'Add a scope to the resource', 'POST', `${API_BASE}/resources/${IDS.resource}/scopes`, mgmt, { name: RESOURCE_SCOPE, description: 'read the address API' }, 201, 'Created', { id: IDS.scope, name: RESOURCE_SCOPE }),
    ...mapped.map(({ m }, i) => call(4 + i, 'setup', `Map attribute: ${m.target}`, 'POST', `${API_BASE}/resources/${IDS.resource}/attributes`, mgmt,
      { name: m.target, type: 'CUSTOM', value: m.wrap === 'act' ? `\${{'sub': #root.context.requestData.actorToken.${m.source}}}` : `\${#root.context.requestData.actorToken.${m.source}}` },
      201, 'Created', { id: `88888888-8888-8888-8888-88888888888${i}`, name: m.target }, m.note, m.evidence)),
    call(4 + mapped.length, 'setup', 'Create the application that sends the exchange', 'POST', `${API_BASE}/applications`, mgmt,
      { name: 'exchanger', enabled: true, type: 'WEB_APP', protocol: 'OPENID_CONNECT', grantTypes: ['CLIENT_CREDENTIALS', 'TOKEN_EXCHANGE'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' },
      201, 'Created', { id: IDS.app, name: 'exchanger', type: 'WEB_APP', grantTypes: ['TOKEN_EXCHANGE', 'CLIENT_CREDENTIALS'], tokenEndpointAuthMethod: 'CLIENT_SECRET_BASIC' }),
    call(5 + mapped.length, 'setup', "Grant the resource's scope to the application", 'POST', `${API_BASE}/applications/${IDS.app}/grants`, mgmt, { resource: { id: IDS.resource }, scopes: [{ id: IDS.scope }] }, 201, 'Created', { id: IDS.grant }),
    ...(assigned ? [call(6 + mapped.length, 'setup', 'Assign the trusted issuer to the application', 'POST', `${API_BASE}/applications/${IDS.app}/trustedIssuerAssignments`, mgmt, { trustedIssuer: { id: IDS.issuer } }, 201, 'Created', { id: IDS.assignment, trustedIssuer: { id: IDS.issuer } })] : []),
  ];
  let n = setup.length;
  const tokenHeaders = (id, secret) => [['Authorization', basic(id, secret)], ['Content-Type', 'application/x-www-form-urlencoded'], ['Accept', 'application/json']];
  const subjForm = 'grant_type=client_credentials&scope=' + encodeURIComponent(RESOURCE_SCOPE);
  const vtc = VENDOR_TOKEN_CALL[vendor.id];
  const exForm = new URLSearchParams({ grant_type: GRANT_TYPE, subject_token: subjectJwt, subject_token_type: ACCESS_TYPE, actor_token: actorJwt, actor_token_type: JWT_TYPE, scope: RESOURCE_SCOPE }).toString();
  const runtime = [
    call(++n, 'runtime', 'Get the PingOne subject token (client credentials)', 'POST', `${AUTH_BASE}/token`, tokenHeaders(APP_CLIENT_ID, MOCK_CLIENT_SECRET), subjForm, 200, 'OK',
      { access_token: subjectJwt, token_type: 'Bearer', expires_in: 3600, scope: RESOURCE_SCOPE }, 'The subject token. In the real flow it is usually a signed-in user\'s access token; the live run used this form.', 'measured'),
    call(++n, 'runtime', `Get the third-party token from ${vendor.name}`, 'POST', `${vtc.host}${vtc.path}`, tokenHeaders('third-party-client-id', MOCK_CLIENT_SECRET), 'grant_type=client_credentials', 200, 'OK',
      { access_token: actorJwt, token_type: 'Bearer', expires_in: 600 }, `The issuer's real endpoint and response shape differ; this is the generic form. The access_token is the actor token, shown decoded on the page.`, 'derived'),
    run.ok
      ? call(++n, 'runtime', 'Token exchange', 'POST', `${AUTH_BASE}/token`, tokenHeaders(APP_CLIENT_ID, MOCK_CLIENT_SECRET), exForm, 200, 'OK',
        { access_token: mockJwt(issued), token_type: 'Bearer', expires_in: 3600, scope: RESOURCE_SCOPE, issued_token_type: ACCESS_TYPE }, 'The new access token: audience is the custom resource, with the mapped claims.')
      : call(++n, 'runtime', 'Token exchange (refused)', 'POST', `${AUTH_BASE}/token`, tokenHeaders(APP_CLIENT_ID, MOCK_CLIENT_SECRET), exForm, 400, 'Bad Request',
        { error: run.error.error, error_description: `${run.error.error_description} (Correlation ID: mock-correlation-id-0000)` }, 'PingOne refuses with invalid_request and says which check failed. No token is issued.'),
  ];
  return { setup, runtime, all: [...setup, ...runtime], tokens: { subject: subjectJwt, actor: actorJwt, issued: run.ok ? mockJwt(issued) : null }, issued };
}
