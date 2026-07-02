# RFC 9470 Step-Up Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a spec-compliant RFC 9470 step-up authentication challenge (401 + `WWW-Authenticate: Bearer error="insufficient_user_authentication"`) to the banking step-up gate, behind a new `ff_rfc9470_challenge` feature flag (default OFF = today's 428+JSON behavior), plus `auth_time` freshness enforcement and in-app education.

**Architecture:** Mode switch at the shared authorization-service layer. A new pure module `rfc9470.js` builds/parses the challenge header; `transactionAuthorizationService.js` wraps the existing step-up body in a flag-aware block (`428+body` vs `401+header+body`); the route applies block headers; the UI parses the header with a new `wwwAuthenticate.js` util and feeds the existing `beginStepUp()` modal flow. Spec: `docs/superpowers/specs/2026-07-02-rfc9470-step-up-challenge-design.md`.

**Tech Stack:** Node/Express (BFF, CommonJS, jest + supertest), React SPA (ESM, vitest), axios client, PingOne as authorization server.

## Global Constraints

- Work happens in the existing worktree `/Users/cmuir/Development/AI-DEMO2/.claude/worktrees/rfc9470-stepup-spec` on branch `worktree-rfc9470-stepup-spec`. Run all commands from the worktree root.
- Stage files explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` prints `worktree-rfc9470-stepup-spec` before each commit.
- Flag default is **OFF**: with `ff_rfc9470_challenge` unset/false, every response must be byte-identical to today (428 + JSON body). All pre-existing tests must keep passing untouched.
- The flag id is exactly `ff_rfc9470_challenge`; the runtime setting is exactly `stepUpMaxAge` (seconds, number, default `0` = freshness check disabled).
- The challenge error code is exactly `insufficient_user_authentication` (RFC 9470 §3).
- Server tests: `npm --prefix demo_api_server test -- <path>` (jest). UI tests: `npm --prefix demo_api_ui run test:unit -- <path>` (vitest).
- The running Docker stack mounts the MAIN checkout, not this worktree — do not attempt live browser verification from the worktree; verification is via the test suites.

---

### Task 1: Feature flag, runtime setting, CORS exposure

Configuration plumbing only — no behavior change while the flag is OFF.

**Files:**

- Modify: `demo_api_server/routes/featureFlags.js` (FLAG_REGISTRY, after the `step_up_enabled` entry ending near line 112)
- Modify: `demo_api_server/config/runtimeSettings.js` (settings object ~line 15, numeric-coercion list ~line 63)
- Modify: `demo_api_server/server.js` (cors options ~line 285)

**Interfaces:**

- Consumes: nothing.
- Produces: flag id `ff_rfc9470_challenge` readable via `configStore.getEffective('ff_rfc9470_challenge') === 'true'` (Task 3); `runtimeSettings.get('stepUpMaxAge')` → number (Tasks 3, 4); `WWW-Authenticate` exposed to cross-origin JS.

- [ ] **Step 1: Register the flag**

In `demo_api_server/routes/featureFlags.js`, inside the `// ── Step-Up Auth ──` section, immediately after the `step_up_enabled` entry (the object ending `runtimeKey: 'stepUpEnabled', // maps to runtimeSettings for live toggle` + `},`), add:

```javascript
  {
    id:           'ff_rfc9470_challenge',
    name:         'Step-Up — RFC 9470 Challenge (401 + WWW-Authenticate)',
    category:     'Step-Up Auth',
    description:
      'Emit the step-up challenge in the standard **RFC 9470** wire format: `401 Unauthorized` with ' +
      '`WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values=…, max_age=…`. ' +
      'OFF (default) keeps the legacy demo format: `428 Precondition Required` with a JSON body. ' +
      'Same gate, same policy — only the signaling changes. The JSON body is included in both modes; ' +
      'in RFC mode the header is the normative signal the client parses.',
    impact:
      'OFF = 428 + JSON body (pre-standard demo format). ' +
      'ON = 401 + WWW-Authenticate header per RFC 9470 — the UI parses the header and runs the same MFA flow.',
    type:         'boolean',
    defaultValue: false,
    docsUrl:      'https://datatracker.ietf.org/doc/rfc9470/',
  },
```

No `runtimeKey` — enforcement reads configStore directly (Task 3).

- [ ] **Step 2: Add the `stepUpMaxAge` runtime setting**

In `demo_api_server/config/runtimeSettings.js`, in the `settings` object after the `stepUpAcrValue` line, add:

```javascript
  // RFC 9470 freshness: require auth_time within this many seconds (0 = disabled)
  stepUpMaxAge: parseFloat(process.env.STEP_UP_MAX_AGE) || 0,
```

In `update()`, add `stepUpMaxAge` to the numeric coercion condition:

```javascript
    if (
      key === 'stepUpAmountThreshold' ||
      key === 'stepUpMaxAge' ||
      key === 'maxTransactionAmount' ||
      key === 'agentTransactionCountLimit' ||
      key === 'agentTransactionValueLimit'
    ) {
```

- [ ] **Step 3: Expose the challenge header via CORS**

In `demo_api_server/server.js`, the cors options at ~line 285 currently read:

```javascript
app.use(cors({
    // In production, CORS_ORIGIN should be set to the frontend URL.
    // Fallback to false (block all cross-origin) rather than reflecting any Origin.
    // The React CRA dev proxy makes requests same-origin in development, so this
    // fallback only affects calls from a different origin without the env var set.
    origin: process.env.CORS_ORIGIN || 'https://api.ping.demo',
    credentials: true
}));
```

Add one property (WWW-Authenticate is not CORS-safelisted, so cross-origin JS can't read it otherwise):

```javascript
    origin: process.env.CORS_ORIGIN || 'https://api.ping.demo',
    credentials: true,
    // RFC 9470: let cross-origin clients read the step-up challenge header
    exposedHeaders: ['WWW-Authenticate']
```

- [ ] **Step 4: Verify the plumbing loads**

Run: `node -e "const rs=require('./demo_api_server/config/runtimeSettings'); rs.update({stepUpMaxAge: '300'}, 't'); console.log(typeof rs.get('stepUpMaxAge'), rs.get('stepUpMaxAge'))"`
Expected: `number 300`

Run: `node -e "const src=require('fs').readFileSync('./demo_api_server/routes/featureFlags.js','utf8'); console.log(src.includes(\"ff_rfc9470_challenge\") ? 'flag registered' : 'MISSING')"`
Expected: `flag registered`

- [ ] **Step 5: Run the existing gate suite to prove no regression**

Run: `npm --prefix demo_api_server test -- src/__tests__/step-up-gate.test.js`
Expected: all tests PASS (baseline unchanged).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/config/runtimeSettings.js demo_api_server/server.js
git commit -m "feat: register ff_rfc9470_challenge flag, stepUpMaxAge setting, expose WWW-Authenticate"
```

---

### Task 2: `rfc9470.js` challenge builder/parser (backend)

**Files:**

- Create: `demo_api_server/services/rfc9470.js`
- Test: `demo_api_server/tests/services/rfc9470.test.js`

**Interfaces:**

- Consumes: nothing.
- Produces: `buildChallengeHeader({ acrValues: string[], maxAge?: number, errorDescription?: string }) => string` and `parseChallengeHeader(value: string) => { scheme: 'Bearer', error: string, error_description?: string, acr_values?: string[], max_age?: number } | null`, plus constant `INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication'`. Task 3 consumes `buildChallengeHeader`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/rfc9470.test.js`:

```javascript
/**
 * @file rfc9470.test.js
 * @description Unit tests for the RFC 9470 WWW-Authenticate challenge builder/parser.
 */

const {
  buildChallengeHeader,
  parseChallengeHeader,
  INSUFFICIENT_USER_AUTHENTICATION,
} = require('../../services/rfc9470');

describe('rfc9470 challenge header', () => {
  it('exports the RFC 9470 error code', () => {
    expect(INSUFFICIENT_USER_AUTHENTICATION).toBe('insufficient_user_authentication');
  });

  it('builds the spec-exact header', () => {
    expect(
      buildChallengeHeader({
        acrValues: ['Multi_Factor'],
        maxAge: 300,
        errorDescription: 'A different authentication level is required',
      })
    ).toBe(
      'Bearer error="insufficient_user_authentication", error_description="A different authentication level is required", acr_values="Multi_Factor", max_age="300"'
    );
  });

  it('space-separates multiple acr values', () => {
    expect(buildChallengeHeader({ acrValues: ['urn:a', 'urn:b'] })).toBe(
      'Bearer error="insufficient_user_authentication", acr_values="urn:a urn:b"'
    );
  });

  it('omits acr_values when empty and max_age when not provided', () => {
    expect(buildChallengeHeader({})).toBe('Bearer error="insufficient_user_authentication"');
  });

  it('includes max_age=0 explicitly (0 is a meaningful value: force fresh auth)', () => {
    expect(buildChallengeHeader({ maxAge: 0 })).toBe(
      'Bearer error="insufficient_user_authentication", max_age="0"'
    );
  });

  it('escapes quotes in error_description', () => {
    expect(buildChallengeHeader({ errorDescription: 'say "hi"' })).toContain(
      'error_description="say \\"hi\\""'
    );
  });

  it('round-trips through parseChallengeHeader', () => {
    const header = buildChallengeHeader({
      acrValues: ['Multi_Factor', 'urn:x'],
      maxAge: 0,
      errorDescription: 'Step up',
    });
    expect(parseChallengeHeader(header)).toEqual({
      scheme: 'Bearer',
      error: 'insufficient_user_authentication',
      error_description: 'Step up',
      acr_values: ['Multi_Factor', 'urn:x'],
      max_age: 0,
    });
  });

  it('returns null for non-Bearer and error-less values', () => {
    expect(parseChallengeHeader('Basic realm="x"')).toBeNull();
    expect(parseChallengeHeader('Bearer realm="x"')).toBeNull();
    expect(parseChallengeHeader(undefined)).toBeNull();
    expect(parseChallengeHeader('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix demo_api_server test -- tests/services/rfc9470.test.js`
Expected: FAIL with `Cannot find module '../../services/rfc9470'`

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/rfc9470.js`:

```javascript
/**
 * rfc9470.js — OAuth 2.0 Step-Up Authentication Challenge (RFC 9470).
 *
 * Builds and parses the WWW-Authenticate Bearer challenge that tells a client
 * "your token is valid, but the user authentication behind it is not strong
 * or fresh enough". The client re-runs the authorization request passing
 * acr_values / max_age through as standard OIDC parameters.
 *
 *   WWW-Authenticate: Bearer error="insufficient_user_authentication",
 *     error_description="...", acr_values="Multi_Factor", max_age="300"
 */

'use strict';

const INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication';

/** Quote a param value per RFC 7235 quoted-string (escape backslash + dquote). */
function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Build the WWW-Authenticate header value for an RFC 9470 step-up challenge.
 * @param {object} [opts]
 * @param {string[]} [opts.acrValues] - required ACR values (space-separated in the header; any one satisfies)
 * @param {number} [opts.maxAge] - max seconds since auth_time; 0 means "force fresh auth"; omit to leave out
 * @param {string} [opts.errorDescription]
 * @returns {string}
 */
function buildChallengeHeader({ acrValues = [], maxAge, errorDescription } = {}) {
  const params = [`error=${quote(INSUFFICIENT_USER_AUTHENTICATION)}`];
  if (errorDescription) params.push(`error_description=${quote(errorDescription)}`);
  if (acrValues.length > 0) params.push(`acr_values=${quote(acrValues.join(' '))}`);
  if (maxAge !== undefined && maxAge !== null) params.push(`max_age=${quote(maxAge)}`);
  return `Bearer ${params.join(', ')}`;
}

/**
 * Parse a WWW-Authenticate Bearer challenge value.
 * @param {string} value
 * @returns {{ scheme: 'Bearer', error: string, error_description?: string,
 *             acr_values?: string[], max_age?: number } | null}
 *          null when not a Bearer challenge or no error param present.
 */
function parseChallengeHeader(value) {
  if (typeof value !== 'string' || !/^Bearer\s/i.test(value.trim())) return null;
  const paramsPart = value.trim().replace(/^Bearer\s+/i, '');
  const out = { scheme: 'Bearer' };
  const re = /([a-zA-Z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(paramsPart)) !== null) {
    const key = m[1];
    const raw = m[2].replace(/\\(.)/g, '$1');
    if (key === 'acr_values') out.acr_values = raw.split(/\s+/).filter(Boolean);
    else if (key === 'max_age') out.max_age = Number(raw);
    else out[key] = raw;
  }
  return out.error ? out : null;
}

module.exports = { buildChallengeHeader, parseChallengeHeader, INSUFFICIENT_USER_AUTHENTICATION };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix demo_api_server test -- tests/services/rfc9470.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/rfc9470.js demo_api_server/tests/services/rfc9470.test.js
git commit -m "feat: add RFC 9470 challenge header builder/parser"
```

---

### Task 3: Flag-aware step-up block in `transactionAuthorizationService`

Replace the three hand-built `{ status: 428, body: buildStepUpBody(...) }` blocks with one flag-aware helper. This is the only place the wire format is decided — every vertical flows through it.

**Files:**

- Modify: `demo_api_server/services/transactionAuthorizationService.js` (requires ~line 26; step-up blocks at ~lines 172–184, 225–237, 331–339)
- Test: `demo_api_server/tests/services/transactionAuthorizationService.rfc9470.test.js` (new)

**Interfaces:**

- Consumes: `buildChallengeHeader` from `./rfc9470` (Task 2); `configStore.getEffective('ff_rfc9470_challenge')`; `runtimeSettings.get('stepUpAcrValue')`, `runtimeSettings.get('stepUpMaxAge')` (Task 1).
- Produces: `evaluateTransactionPolicy()` blocks now shaped `{ status: number, headers?: {[k:string]: string}, body: object }` — Task 4's route applies `headers` when present. `buildStepUpBody()` signature and body shape are unchanged.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/services/transactionAuthorizationService.rfc9470.test.js`:

```javascript
/**
 * @file transactionAuthorizationService.rfc9470.test.js
 * @description The step-up block is a mode switch on ff_rfc9470_challenge:
 *   OFF (default) → legacy { status: 428, body } (no headers key)
 *   ON            → RFC 9470 { status: 401, headers: { WWW-Authenticate }, body }
 * The JSON body is identical in both modes.
 */

jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

jest.mock('../../services/simulatedAuthorizeService', () => ({
  isSimulatedModeEnabled: jest.fn(() => true),
  resolveAuthorizeMode: jest.fn(() => ({ failoverMode: 'fallback_simulated' })),
  evaluateTransaction: jest.fn(),
  buildAuthorizeFallbackSignal: jest.fn(() => ({})),
}));

jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
  EVENT_CATEGORIES: { AUTHORIZE: 'authorize', HITL: 'hitl' },
}));

const configStore = require('../../services/configStore');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const runtimeSettings = require('../../config/runtimeSettings');
const { evaluateTransactionPolicy } = require('../../services/transactionAuthorizationService');

const evaluateOpts = {
  runtimeSettings,
  userRole: 'user',
  userId: 'u1',
  amount: 500,
  type: 'transfer',
  acr: null,
  useCaseId: '',
};

let originalSettings;
beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
});

beforeEach(() => {
  jest.clearAllMocks();
  simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
  simulatedAuthorizeService.evaluateTransaction.mockResolvedValue({
    decision: 'INDETERMINATE',
    stepUpRequired: true,
    consentRequired: false,
    path: 'sim',
    decisionId: 'd1',
    raw: {},
  });
  runtimeSettings.update(
    { stepUpAcrValue: 'Multi_Factor', stepUpMaxAge: 300, stepUpMethod: 'ciba' },
    'test'
  );
});

afterAll(() => {
  runtimeSettings.update(
    {
      stepUpAcrValue: originalSettings.stepUpAcrValue,
      stepUpMaxAge: originalSettings.stepUpMaxAge,
      stepUpMethod: originalSettings.stepUpMethod,
    },
    'test-cleanup'
  );
});

describe('step-up block mode switch (ff_rfc9470_challenge)', () => {
  it('flag OFF → legacy 428 block with no headers', async () => {
    configStore.getEffective.mockReturnValue(null); // flag unset = OFF

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.ran).toBe(true);
    expect(res.block.status).toBe(428);
    expect(res.block.headers).toBeUndefined();
    expect(res.block.body.error).toBe('step_up_required');
    expect(res.block.body.step_up_acr).toBe('Multi_Factor');
    expect(res.block.body.step_up_url).toBe('/api/auth/oauth/user/stepup');
  });

  it('flag ON → 401 with spec-exact WWW-Authenticate header, same body', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.status).toBe(401);
    expect(res.block.headers['WWW-Authenticate']).toBe(
      'Bearer error="insufficient_user_authentication", ' +
        'error_description="A different authentication level is required", ' +
        'acr_values="Multi_Factor", max_age="300"'
    );
    expect(res.block.body.error).toBe('step_up_required');
    expect(res.block.body.step_up_acr).toBe('Multi_Factor');
  });

  it('flag ON → challenge max_age reflects stepUpMaxAge (0 when disabled)', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );
    runtimeSettings.update({ stepUpMaxAge: 0 }, 'test');

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.headers['WWW-Authenticate']).toContain('max_age="0"');
  });

  it('fallback-simulated path keeps authorizeFallback in the body in RFC mode', async () => {
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_rfc9470_challenge' ? 'true' : null
    );
    // Force the PingOne path, make it throw, and fall back to simulated.
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
    configStore.get.mockImplementation((key) =>
      key === 'authorize_decision_endpoint_id' ? 'ep-1' : null
    );
    const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
    pingOneAuthorizeService.evaluateTransaction.mockRejectedValue(new Error('down'));
    simulatedAuthorizeService.buildAuthorizeFallbackSignal.mockReturnValue({ fellBack: true });

    const res = await evaluateTransactionPolicy(evaluateOpts);

    expect(res.block.status).toBe(401);
    expect(res.block.headers['WWW-Authenticate']).toContain('insufficient_user_authentication');
    expect(res.block.body.authorizeFallback).toEqual({ fellBack: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix demo_api_server test -- tests/services/transactionAuthorizationService.rfc9470.test.js`
Expected: FAIL — flag ON cases get `status: 428` and `headers` undefined (mode switch not implemented yet). The flag OFF case may already pass.

- [ ] **Step 3: Implement `buildStepUpBlock` and use it at all three sites**

In `demo_api_server/services/transactionAuthorizationService.js`:

(a) Add the require next to the existing ones (~line 29):

```javascript
const { buildChallengeHeader } = require('./rfc9470');
```

(b) Immediately after the `buildStepUpBody` function (ends ~line 49), add:

```javascript
/**
 * Wrap the step-up body in a transport block — the RFC 9470 mode switch.
 * ff_rfc9470_challenge OFF (default): legacy 428 + JSON body (RFC 6585 demo format).
 * ON: RFC 9470 — 401 + WWW-Authenticate insufficient_user_authentication challenge.
 * The JSON body is kept in BOTH modes (step_up_url / step_up_method are demo
 * conveniences); in RFC mode the header is the normative signal clients parse.
 */
function buildStepUpBlock({ useSimulated, policyId, runtimeSettings, extra = {} }) {
  const body = { ...buildStepUpBody({ useSimulated, policyId, runtimeSettings }), ...extra };
  if (configStore.getEffective('ff_rfc9470_challenge') !== 'true') {
    return { status: 428, body };
  }
  const maxAge = parseFloat(runtimeSettings.get('stepUpMaxAge')) || 0;
  return {
    status: 401,
    headers: {
      'WWW-Authenticate': buildChallengeHeader({
        acrValues: [runtimeSettings.get('stepUpAcrValue')],
        maxAge,
        errorDescription: 'A different authentication level is required',
      }),
    },
    body,
  };
}
```

(c) Replace the simulated-path block (~lines 172–184):

```javascript
      if (r.stepUpRequired) {
        return {
          ran: true,
          block: buildStepUpBlock({
            useSimulated: true,
            policyId: AUTHORIZE_POLICY_ID,
            runtimeSettings,
          }),
        };
      }
```

(d) Replace the PingOne-path block (~lines 225–237):

```javascript
    if (r.stepUpRequired) {
      return {
        ran: true,
        block: buildStepUpBlock({
          useSimulated: false,
          policyId: AUTHORIZE_POLICY_ID,
          runtimeSettings,
        }),
      };
    }
```

(e) Replace the fallback-simulated block (~lines 331–339):

```javascript
      if (fallback.stepUpRequired) {
        return {
          ran: true,
          block: buildStepUpBlock({
            useSimulated: true,
            policyId: AUTHORIZE_POLICY_ID,
            runtimeSettings,
            extra: { authorizeFallback },
          }),
        };
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix demo_api_server test -- tests/services/transactionAuthorizationService.rfc9470.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the server test suite for regressions**

Run: `npm --prefix demo_api_server test`
Expected: PASS — no existing test asserts against these three blocks other than via the route (which still receives `status: 428` while the flag is OFF).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/transactionAuthorizationService.js demo_api_server/tests/services/transactionAuthorizationService.rfc9470.test.js
git commit -m "feat: flag-aware RFC 9470 step-up block in transaction authorization"
```

---

### Task 4: Route header emission + `auth_time` freshness

Two route-layer changes: apply `block.headers` when present, and downgrade a stale-but-strong ACR before policy evaluation so freshness is actually enforced (RFC 9470 §5). Also surface `auth_time` on `req.user`.

**Files:**

- Modify: `demo_api_server/middleware/auth.js` (both `req.user = {` constructions, ~line 703 and ~line 824)
- Modify: `demo_api_server/routes/transactions.js` (effectiveAcr block ~lines 540–546; emission ~line 590)
- Test: `demo_api_server/src/__tests__/step-up-gate.test.js` (extend)

**Interfaces:**

- Consumes: `authz.block.headers` shape from Task 3; `runtimeSettings.get('stepUpMaxAge')` from Task 1.
- Produces: `req.user.authTime` (number | null, epoch seconds from the token's `auth_time` claim) — available to any later consumer; HTTP responses now carry `WWW-Authenticate` when the service put one on the block.

- [ ] **Step 1: Add `authTime` to both `req.user` constructions in auth.js**

In `demo_api_server/middleware/auth.js`, find both `req.user = {` object literals (one near line 703, one near line 824 — each already contains `acr: decoded.acr || null,`). In **each**, directly under the `acr:` line, add:

```javascript
        authTime: Number.isFinite(Number(decoded.auth_time)) ? Number(decoded.auth_time) : null, // OIDC auth_time — when the user actually authenticated (RFC 9470 freshness)
```

(Match each site's existing indentation.)

Coverage note: the gate tests mock the auth middleware, so this auth.js line is not exercised by them — the freshness tests inject `authTime` via the mock's `x-test-user` pass-through, which proves the route logic. The claim mapping itself (`decoded.auth_time` → `req.user.authTime`) is a one-line mirror of the adjacent `acr` mapping and is verified live once merged.

- [ ] **Step 2: Write the failing route tests**

In `demo_api_server/src/__tests__/step-up-gate.test.js`, append inside the top-level `describe('Step-Up MFA Gate — POST /api/transactions', ...)` block (after the HITL describe ends, before the final `});`):

```javascript
  // ── RFC 9470 challenge pass-through (ff_rfc9470_challenge) ───────────────────
  describe('RFC 9470 challenge pass-through', () => {
    it('applies block.headers and status from the authorization service', async () => {
      const txAuthz = require('../../services/transactionAuthorizationService');
      const header =
        'Bearer error="insufficient_user_authentication", acr_values="Multi_Factor", max_age="0"';
      txAuthz.evaluateTransactionPolicy.mockResolvedValueOnce({
        ran: true,
        block: {
          status: 401,
          headers: { 'WWW-Authenticate': header },
          body: {
            error: 'step_up_required',
            hitl: { type: 'step_up' },
            step_up_url: '/api/auth/oauth/user/stepup',
            step_up_acr: 'Multi_Factor',
            step_up_method: 'ciba',
          },
        },
      });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe(header);
      expect(res.body.error).toBe('step_up_required'); // body kept in RFC mode
    });
  });

  // ── auth_time freshness (stepUpMaxAge, RFC 9470 §5) ─────────────────────────
  describe('auth_time freshness (stepUpMaxAge)', () => {
    it('downgrades a stale strong ACR so the gate fires', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 300 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 3600 })
        )
        .send(highValueWithdrawal(500));

      // Route downgraded acr to null (stale auth) → the gate fires.
      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
    });

    it('passes when auth_time is fresh', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 300 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 10 })
        )
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });

    it('is disabled by default (stepUpMaxAge=0): stale auth_time is ignored', async () => {
      runtimeSettings.update(
        { stepUpEnabled: true, stepUpAmountThreshold: 250, stepUpAcrValue: 'Multi_factor', stepUpMaxAge: 0 },
        'test'
      );

      const res = await request(app)
        .post('/api/transactions')
        .set(
          'x-test-user',
          customerUser({ acr: 'Multi_factor', authTime: Math.floor(Date.now() / 1000) - 999999 })
        )
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });
```

Also add `stepUpMaxAge: 0,` to the `runtimeSettings.update({...})` call inside the existing `afterEach` (so freshness config never leaks between tests).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm --prefix demo_api_server test -- src/__tests__/step-up-gate.test.js`
Expected: the pass-through test FAILS (route ignores `headers`, and 401 without them); the "downgrades a stale strong ACR" test FAILS (gate passes because acr looks strong); the other two freshness tests may already pass.

- [ ] **Step 4: Implement the route changes**

In `demo_api_server/routes/transactions.js`:

(a) Replace the effectiveAcr block (~lines 540–546):

```javascript
    // If the user completed step-up MFA via email OTP in this session, treat as strong acr.
    // Consume the flag (single-use) so subsequent transactions still enforce the gate.
    let effectiveAcr = req.user.acr;
    let sessionStepUpFresh = false;
    if (req.session?.stepUpVerified > Date.now()) {
      effectiveAcr = 'Multi_Factor';
      sessionStepUpFresh = true;
      req.session.stepUpVerified = 0;
    }

    // RFC 9470 §5 freshness: when stepUpMaxAge > 0, a strong ACR from a stale
    // authentication event is NOT sufficient — downgrade it so the gate fires
    // and the challenge sends the user back through a fresh ceremony.
    const stepUpMaxAge = parseFloat(runtimeSettings.get('stepUpMaxAge')) || 0;
    if (stepUpMaxAge > 0 && !sessionStepUpFresh && effectiveAcr) {
      const authTime = Number(req.user.authTime);
      const ageSeconds = Number.isFinite(authTime) ? Date.now() / 1000 - authTime : Infinity;
      if (ageSeconds > stepUpMaxAge) {
        console.log(
          `[StepUp] auth_time stale (${Math.round(ageSeconds)}s > ${stepUpMaxAge}s) — downgrading acr for gate evaluation`
        );
        effectiveAcr = null;
      }
    }
```

(b) At the generic block emission (~line 590), replace:

```javascript
        } else {
          return res.status(authz.block.status).json(body);
        }
```

with:

```javascript
        } else {
          // RFC 9470 mode attaches a WWW-Authenticate challenge to the block.
          if (authz.block.headers) res.set(authz.block.headers);
          return res.status(authz.block.status).json(body);
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm --prefix demo_api_server test -- src/__tests__/step-up-gate.test.js`
Expected: PASS — all pre-existing tests plus the 4 new ones.

- [ ] **Step 6: Run the full server suite**

Run: `npm --prefix demo_api_server test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/middleware/auth.js demo_api_server/routes/transactions.js demo_api_server/src/__tests__/step-up-gate.test.js
git commit -m "feat: emit RFC 9470 challenge headers and enforce auth_time freshness at the gate"
```

---

### Task 5: UI `wwwAuthenticate.js` util + session-expiry guard test

**Files:**

- Create: `demo_api_ui/src/utils/wwwAuthenticate.js`
- Test: `demo_api_ui/src/utils/__tests__/wwwAuthenticate.test.js`
- Test: `demo_api_ui/src/utils/__tests__/authUi.test.js` (extend — one guard case)

**Interfaces:**

- Consumes: axios `error.response` (`{ status, headers, data }`; axios lower-cases header names).
- Produces: `parseWwwAuthenticate(value: string) => { scheme, error?, error_description?, acr_values?: string[], max_age?: number } | null` and `extractRfc9470Challenge(response) => object | null` where the object is shaped like the legacy 428 body (`step_up_acr`, `step_up_method`, `step_up_url`, …) plus `rfc9470: { raw: string, acr_values, max_age, ... }` when the header parsed. Task 6 feeds this straight into `beginStepUp()`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/utils/__tests__/wwwAuthenticate.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';
import { parseWwwAuthenticate, extractRfc9470Challenge } from '../wwwAuthenticate';

const HEADER =
  'Bearer error="insufficient_user_authentication", error_description="A different authentication level is required", acr_values="Multi_Factor", max_age="300"';

describe('parseWwwAuthenticate', () => {
  it('parses an RFC 9470 challenge', () => {
    expect(parseWwwAuthenticate(HEADER)).toEqual({
      scheme: 'Bearer',
      error: 'insufficient_user_authentication',
      error_description: 'A different authentication level is required',
      acr_values: ['Multi_Factor'],
      max_age: 300,
    });
  });

  it('splits multiple acr_values on spaces', () => {
    const parsed = parseWwwAuthenticate(
      'Bearer error="insufficient_user_authentication", acr_values="urn:a urn:b"'
    );
    expect(parsed.acr_values).toEqual(['urn:a', 'urn:b']);
  });

  it('returns null for non-Bearer or empty values', () => {
    expect(parseWwwAuthenticate('Basic realm="x"')).toBeNull();
    expect(parseWwwAuthenticate('')).toBeNull();
    expect(parseWwwAuthenticate(undefined)).toBeNull();
  });

  it('unescapes quoted characters', () => {
    expect(
      parseWwwAuthenticate(
        'Bearer error="insufficient_user_authentication", error_description="say \\"hi\\""'
      ).error_description
    ).toBe('say "hi"');
  });
});

describe('extractRfc9470Challenge', () => {
  const body = {
    error: 'step_up_required',
    step_up_method: 'email',
    step_up_url: '/api/auth/oauth/user/stepup',
    step_up_acr: 'Multi_Factor',
  };

  it('normalizes a 401 challenge into the legacy 428 shape', () => {
    const out = extractRfc9470Challenge({
      status: 401,
      headers: { 'www-authenticate': HEADER },
      data: body,
    });
    expect(out.error).toBe('step_up_required');
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.step_up_method).toBe('email');
    expect(out.step_up_url).toBe('/api/auth/oauth/user/stepup');
    expect(out.rfc9470.raw).toBe(HEADER);
    expect(out.rfc9470.max_age).toBe(300);
  });

  it('prefers the header acr over the body field (header is normative)', () => {
    const out = extractRfc9470Challenge({
      status: 401,
      headers: {
        'www-authenticate':
          'Bearer error="insufficient_user_authentication", acr_values="urn:header:acr"',
      },
      data: { ...body, step_up_acr: 'BodyAcr' },
    });
    expect(out.step_up_acr).toBe('urn:header:acr');
  });

  it('falls back to body fields when the header is missing/unparseable (with a warning)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = extractRfc9470Challenge({ status: 401, headers: {}, data: body });
    expect(out.step_up_acr).toBe('Multi_Factor');
    expect(out.rfc9470).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns null for ordinary 401s and non-401s', () => {
    expect(
      extractRfc9470Challenge({ status: 401, headers: {}, data: { error: 'session_expired' } })
    ).toBeNull();
    expect(extractRfc9470Challenge({ status: 428, headers: {}, data: body })).toBeNull();
    expect(extractRfc9470Challenge(undefined)).toBeNull();
    expect(extractRfc9470Challenge(null)).toBeNull();
  });
});
```

In `demo_api_ui/src/utils/__tests__/authUi.test.js`, add one case inside the existing describe for `isSessionExpiredApiError` (import is already there — this guards the 401-collision risk from the spec):

```javascript
  it('does not treat an RFC 9470 step-up 401 body as session expiry', () => {
    expect(
      isSessionExpiredApiError({
        error: 'step_up_required',
        error_description:
          'This transaction requires additional authentication (MFA) as required by the authorization policy.',
      })
    ).toBe(false);
  });
```

(If that file has no `isSessionExpiredApiError` describe, add the import `isSessionExpiredApiError` from `../authUi` and a new top-level describe with just this case.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix demo_api_ui run test:unit -- src/utils/__tests__/wwwAuthenticate.test.js src/utils/__tests__/authUi.test.js`
Expected: wwwAuthenticate tests FAIL (module not found); the authUi case should PASS already (documenting the guard).

- [ ] **Step 3: Write the implementation**

Create `demo_api_ui/src/utils/wwwAuthenticate.js`:

```javascript
/**
 * wwwAuthenticate.js — parse RFC 9470 step-up challenges.
 *
 * When ff_rfc9470_challenge is ON, the BFF signals step-up as
 *   401 + WWW-Authenticate: Bearer error="insufficient_user_authentication",
 *   acr_values="...", max_age="..."
 * instead of the legacy 428 + JSON body. extractRfc9470Challenge() normalizes
 * that into the same shape beginStepUp() already consumes.
 */

const INSUFFICIENT_USER_AUTHENTICATION = 'insufficient_user_authentication';

/** Parse a WWW-Authenticate Bearer value into its params. Null if not Bearer. */
export function parseWwwAuthenticate(value) {
  if (typeof value !== 'string' || !/^Bearer\s/i.test(value.trim())) return null;
  const paramsPart = value.trim().replace(/^Bearer\s+/i, '');
  const out = { scheme: 'Bearer' };
  const re = /([a-zA-Z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(paramsPart)) !== null) {
    const key = m[1];
    const raw = m[2].replace(/\\(.)/g, '$1');
    if (key === 'acr_values') out.acr_values = raw.split(/\s+/).filter(Boolean);
    else if (key === 'max_age') out.max_age = Number(raw);
    else out[key] = raw;
  }
  return out;
}

/**
 * Extract a normalized step-up descriptor from an axios error.response when
 * the server used the RFC 9470 401 challenge. Returns an object shaped like
 * the legacy 428 body (beginStepUp-compatible) with an extra `rfc9470` member
 * carrying the raw header + parsed params — or null when the response is not
 * an RFC 9470 step-up challenge (ordinary 401s fall through untouched).
 */
export function extractRfc9470Challenge(response) {
  if (!response || response.status !== 401) return null;
  const headerValue = response.headers?.['www-authenticate'] || null;
  const body = response.data && typeof response.data === 'object' ? response.data : {};
  const parsed = headerValue ? parseWwwAuthenticate(headerValue) : null;

  if (parsed?.error === INSUFFICIENT_USER_AUTHENTICATION) {
    return {
      ...body,
      error: body.error || 'step_up_required',
      step_up_acr: parsed.acr_values?.[0] || body.step_up_acr || '',
      rfc9470: { raw: headerValue, ...parsed },
    };
  }

  // Demo resilience: RFC-mode body without a readable/parseable header
  // (e.g. a proxy stripped it). Fall back to the JSON body fields.
  if (body.error === 'step_up_required') {
    console.warn(
      '[rfc9470] 401 step-up response without a parseable WWW-Authenticate header — falling back to body fields'
    );
    return { ...body };
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix demo_api_ui run test:unit -- src/utils/__tests__/wwwAuthenticate.test.js src/utils/__tests__/authUi.test.js`
Expected: PASS (all cases in both files).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/utils/wwwAuthenticate.js demo_api_ui/src/utils/__tests__/wwwAuthenticate.test.js demo_api_ui/src/utils/__tests__/authUi.test.js
git commit -m "feat: RFC 9470 WWW-Authenticate parser and step-up challenge extractor (UI)"
```

---

### Task 6: Wire the dashboard catch sites + show the raw challenge

Four catch blocks in `UserDashboardPing2026.js` currently branch on `status === 428` → `beginStepUp(...)`. Add an `else if` for the RFC-mode 401 at each, and show the raw challenge header on the step-up toast (education).

**Files:**

- Modify: `demo_api_ui/src/components/UserDashboardPing2026.js`
  - import block (top of file)
  - state declarations near line 264 (`stepUpMethod` area)
  - `beginStepUp` (~line 1078)
  - toast effect (~lines 1199–1230)
  - catch sites: transfer ~line 1522, deposit ~line 1618, withdrawal ~line 1718, post-consent retry ~line 2631

**Interfaces:**

- Consumes: `extractRfc9470Challenge` from `../utils/wwwAuthenticate` (Task 5); existing `beginStepUp(d)` which reads `d.step_up_method` / `d.step_up_acr`.
- Produces: no new exports — behavior only. New state `stepUpChallengeRaw: string`.

- [ ] **Step 1: Add the import**

At the top of `demo_api_ui/src/components/UserDashboardPing2026.js`, alongside the other `../utils/` imports:

```javascript
import { extractRfc9470Challenge } from "../utils/wwwAuthenticate";
```

- [ ] **Step 2: Add raw-challenge state and capture it in beginStepUp**

Near the existing step-up state (~line 264, next to the `stepUpMethod` state declaration), add:

```javascript
  // Raw RFC 9470 WWW-Authenticate value (set when the challenge arrived as
  // 401 + header rather than legacy 428 + body) — shown on the step-up toast.
  const [stepUpChallengeRaw, setStepUpChallengeRaw] = useState("");
```

Replace `beginStepUp` (~line 1078):

```javascript
  /** Enter the step-up gate from a 428 body or an RFC 9470 401 challenge (method + ACR for CIBA). Inverse of dismissStepUp. */
  const beginStepUp = useCallback((d) => {
    setStepUpMethod(d?.step_up_method || "email");
    setCibaAcr(d?.step_up_acr || "");
    setStepUpChallengeRaw(d?.rfc9470?.raw || "");
    setCibaStatus("idle");
    setStepUpRequired(true);
  }, []);
```

- [ ] **Step 3: Show the raw challenge on the step-up toast**

In the toast effect (~line 1199): in `onToastClosed`, add `setStepUpChallengeRaw("");` after `setCibaAcr("");`. Then, in the toast `body` JSX, directly after the closing `</p>` of the "Additional verification required." paragraph, add:

```jsx
        {stepUpChallengeRaw && (
          <p
            style={{
              fontFamily: "monospace",
              fontSize: 11,
              background: "rgba(0,0,0,0.25)",
              padding: 6,
              borderRadius: 4,
              wordBreak: "break-all",
              marginBottom: 8,
            }}
          >
            <strong>RFC 9470 challenge:</strong> WWW-Authenticate:{" "}
            {stepUpChallengeRaw}
          </p>
        )}
```

Add `stepUpChallengeRaw` to that effect's dependency array (keep all existing entries).

- [ ] **Step 4: Wire the three transaction catch sites**

In each of the transfer (~1522), deposit (~1618), and withdrawal (~1718) catch blocks, the code currently reads (transfer shown; the others are identical in shape):

```javascript
      if (error.response?.status === 428) {
        if (d?.error === "hitl_required" && d?.hitl?.type === "consent") {
          // ...openConsentFlowForPayload({...}); return;
        }
        beginStepUp(error.response.data);
      } else if (error.response?.status === 403) {
```

At each site, declare `rfc9470StepUp` directly above the `if` chain (after the existing `const d = error.response?.data;`) and insert an `else if` between the 428 branch and the 403 branch:

```javascript
      // RFC 9470 mode (ff_rfc9470_challenge): 401 + WWW-Authenticate challenge.
      // Ordinary 401s yield null here and keep their existing handling.
      const rfc9470StepUp = extractRfc9470Challenge(error.response);
      if (error.response?.status === 428) {
        if (d?.error === "hitl_required" && d?.hitl?.type === "consent") {
          // ... (unchanged consent block)
        }
        beginStepUp(error.response.data);
      } else if (rfc9470StepUp) {
        beginStepUp(rfc9470StepUp);
      } else if (error.response?.status === 403) {
```

- [ ] **Step 5: Wire the post-consent retry site (~line 2631)**

Currently:

```javascript
              } catch (err) {
                if (err.response?.status === 428) {
                  beginStepUp(err.response.data);
                } else {
                  notifyError(
                    err.response?.data?.error_description ||
                      err.response?.data?.error ||
                      "Transaction failed after consent.",
                  );
                }
              }
```

Change to:

```javascript
              } catch (err) {
                const rfc9470StepUp = extractRfc9470Challenge(err.response);
                if (err.response?.status === 428) {
                  beginStepUp(err.response.data);
                } else if (rfc9470StepUp) {
                  beginStepUp(rfc9470StepUp);
                } else {
                  notifyError(
                    err.response?.data?.error_description ||
                      err.response?.data?.error ||
                      "Transaction failed after consent.",
                  );
                }
              }
```

- [ ] **Step 6: Run the UI unit suite**

Run: `npm --prefix demo_api_ui run test:unit`
Expected: PASS — no existing test exercises these catch branches with 401s; this run proves no import/syntax/regression damage.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/UserDashboardPing2026.js
git commit -m "feat: handle RFC 9470 401 step-up challenges in the banking dashboard"
```

---

### Task 7: In-app education copy

**Files:**

- Modify: `demo_api_ui/src/config/architecture-sim-scenarios.js` (step-up-mfa scenario, steps at ~lines 224–241)

**Interfaces:**

- Consumes: nothing (copy only). The flag description (Task 1) and the toast raw-header display (Task 6) are the other two education surfaces, already done.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Update the challenge step copy**

In the `step-up-mfa` scenario, replace the BFF gate step:

```javascript
      {
        nodes: ['n-bff'],
        edges: ['e-browser-bff'],
        desc: 'BFF Step-Up Gate: amount ≥ threshold → 428 step_up_required.',
        why: '428 Precondition Required (RFC 6585) signals "satisfy a prerequisite before this request can proceed." The BFF tells the client exactly what is needed (acr_values, nonce) so the UI can guide the user through the MFA step. The existing access token is explicitly NOT used for this transaction.',
      },
```

with:

```javascript
      {
        nodes: ['n-bff'],
        edges: ['e-browser-bff'],
        desc: 'BFF Step-Up Gate: amount ≥ threshold → challenge. Legacy: 428 step_up_required · RFC 9470 mode: 401 + WWW-Authenticate.',
        why: 'One gate, two wire formats — toggled by the "Step-Up — RFC 9470 Challenge" feature flag. Legacy mode returns 428 Precondition Required (RFC 6585) with a JSON body. RFC 9470 mode returns the IETF standard: 401 with WWW-Authenticate: Bearer error="insufficient_user_authentication", acr_values="Multi_Factor", max_age="300". acr_values says how STRONG the new authentication must be; max_age says how FRESH (seconds since auth_time). Because the challenge is standardized, any conforming OAuth client — not just this UI — knows to re-run authorization with exactly those parameters. The raw header is shown on the step-up toast and in the API traffic inspector. In both modes the existing access token is explicitly NOT used for this transaction.',
      },
```

- [ ] **Step 2: Mention auth_time verification in the code-exchange step**

In the same scenario, the later step reading `desc: 'BFF exchanges the new code; verifies the acr claim matches the required level.'` — replace its `desc` with:

```javascript
        desc: 'BFF exchanges the new code; verifies the acr claim matches the required level and auth_time satisfies max_age.',
```

and append this sentence to the end of that step's existing `why` string:

```javascript
 When a max_age freshness window is configured (stepUpMaxAge), the resource server also checks the auth_time claim — a strong acr from a stale login is rejected, per RFC 9470 §5.
```

- [ ] **Step 3: Run the UI unit suite (scenario file is imported by tested components)**

Run: `npm --prefix demo_api_ui run test:unit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/config/architecture-sim-scenarios.js
git commit -m "docs: teach both step-up wire formats (legacy 428 vs RFC 9470 401) in the sim scenario"
```

---

### Task 8: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full backend suite**

Run: `npm --prefix demo_api_server test`
Expected: PASS, including the two new test files and the extended gate suite.

- [ ] **Step 2: Full UI unit suite**

Run: `npm --prefix demo_api_ui run test:unit`
Expected: PASS.

- [ ] **Step 3: Flag-OFF byte-identical check (grep-level sanity)**

Confirm no default changed: `node -e "const rs=require('./demo_api_server/config/runtimeSettings'); console.log('stepUpMaxAge default:', rs.get('stepUpMaxAge'))"`
Expected: `stepUpMaxAge default: 0`

- [ ] **Step 4: Confirm success criteria from the spec**

- Flag OFF: all existing tests pass untouched — evidenced by Steps 1–2.
- Flag ON: a ≥$250 transfer with a single-factor token yields the spec-exact 401 challenge — evidenced by the service test (Task 3) and pass-through route test (Task 4).
- Existing MFA modal flow completes from the challenge — wiring in Task 6 feeds the same `beginStepUp()`; live click-through happens after merge (Docker serves the main checkout, not this worktree).

- [ ] **Step 5: Verify branch and log**

Run: `git branch --show-current && git log --oneline main..HEAD`
Expected: `worktree-rfc9470-stepup-spec` and 9 commits (1 spec + 1 plan + 7 task commits from Tasks 1–7).
