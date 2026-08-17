# Resource Server AAM Sideband Checkpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: PARKED — plan only, do not implement until Curtis says go.**
The two companion UI pages already shipped in PR #1899 (Diagrams → Resource
Server Placement (MM), Authorize → Resource Server Checkpoint). The checkpoint
page currently shows canned payloads and is labeled "not wired"; this plan is
the wiring.

**Goal:** Add a Kong-emulating AAM sideband checkpoint inside the final
resource server (`demo_api_server` `/api/accounts` + `/api/transactions`) that
asks PingOne Authorize (mock or real) for a decision before any handler runs
and for response redaction after, exactly as Kong's `ping-auth` plugin would.

**Architecture:** A new middleware pair in `demo_api_server` speaks the AAM
sideband contract already mocked at `demo_authz_server` (`/sideband/request` +
`/sideband/response` on :9001). Inbound leg fires before local auth for
agent-originated calls only (`X-Agent-Sub` present) behind a new flag
`ff_rs_sideband` (default OFF); a deny is a complete P1AZ-authored response
relayed verbatim; sideband unreachable = fail-closed 503 for agent traffic.
Outbound leg rewrites/redacts the response body on PERMIT. A new Token Chain
event `rs-sideband` surfaces the decision in the UI.

**Tech Stack:** Node/Express (CommonJS), jest + supertest, existing
`demo_authz_server` mock sideband, PingOne Authorize AAM (real path optional).

**Spec:** No standalone spec. Sources of truth, in order:
1. `demo_authz_server/routes/sideband.js` + `demo_authz_server/sideband.test.js`
   — the pinned live sideband contract. **Read both before writing any code.**
2. `docs/superpowers/specs/2026-07-27-aam-end-to-end-design.md` — prior AAM
   work (IG route; protects only `GET /aam/health` today).
3. The shipped UI mock `demo_api_ui/src/components/ResourceServerCheckpointPage.jsx`
   — the four demo scenarios this plan must make real.

## Research findings (do not re-derive)

- **Final resource server = `demo_api_server` itself.** `oauth-mcp`'s
  `BankingAPIClient` (`oauth-mcp/src/banking/BankingAPIClient.ts:173,243,255,274`)
  calls `https://api.ping.demo:3001/api/accounts|transactions` after the
  "Step 9" RFC 8693 exchange (`oauth-mcp/src/auth/TokenExchangeService.ts`).
  Data store: `demo_api_server/data/store.js`.
- **Token arriving at the RS:** Bearer JWT, `aud` = step-9 resource URI
  (`MCP_STEP9_RESOURCE_URI`; scope-topology default
  `https://banking-resource-server.ping.demo` per
  `demo_authz_server/scopeTopology.js:130`), scopes narrowed per tool by
  `oauth-mcp/src/tools/toolScopeMap.ts` (`read` / `write` / `sensitive:read`),
  nested `act` chain, plus headers `X-Agent-Sub` and `X-MCP-Tool`
  (`BankingAPIClient.ts:93-94`).
- **Placement rule (Curtis-confirmed):** upstream hops (IG :3036 / Node
  MCP-GW :3005, MCP server :8080) keep their own token validation; the RS
  validates ONLY the step-9 token addressed to it. The sideband gate is the
  Kong-style perimeter; the existing `authenticateToken` stays because
  handlers need `req.user`, and it validates exactly that step-9 token —
  no upstream token is ever re-checked.
- **Existing middleware order on those routes** (`demo_api_server/server.js`
  ~1314-1353): `authenticateToken` (JWKS, `middleware/auth.js:500-539,692`) →
  `requireScopes([...])` per route → `agentRestrictionsGate`
  (`middleware/agentRestrictionsGate.js:108-210`, fires on `X-Agent-Sub`,
  flag `ff_agent_restrictions`, HITL on DENY). The new gate mounts BEFORE
  `authenticateToken` and does not replace `agentRestrictionsGate` (coarse
  HTTP/AAM layer vs fine business layer).
- **Mock sideband contract quirks** (pinned by `demo_authz_server/sideband.test.js`):
  presence/absence of `response` in the reply IS the decision (absent =
  PERMIT); `response_code` is a **string**; `headers` is an **array of
  single-key objects**; `url` and `http_version` must be echoed. Mounts:
  `demo_authz_server/index.js:54` (`POST /sideband/request`) and `:58`
  (`POST /sideband/response`); response leg only runs on ALLOW.
- **Real PingOne AAM:** service URL pattern
  `https://http-access-api.pingone.com/v1/environments/<envId>` (see
  `ping-gateway/README.md:156`), gateway credential sent in `CLIENT-TOKEN`
  header. Management API calls the "API services" **`apiServers`**
  (`ping-gateway/README.md:140`); operations via
  `POST /apiServers/{id}/operations`. Kong's plugin equivalent:
  `kong-plugin-ping-auth` (`service_url`, `shared_secret`,
  `secret_header_name` default `CLIENT-TOKEN`).
- **Flag precedent:** `ff_aam` in `demo_api_server/services/configStore.js:368`
  (default), env mapping `FF_AAM` (`:1158`, `:2188`). Mirror those three sites
  for `ff_rs_sideband`. Staging `configStore.js` triggers the pre-commit hook
  that regenerates `mcp-tool-schemas.json` — expected, don't fight it.
- **Token Chain UI wiring points** for the new `rs-sideband` event:
  emit near `demo_api_server/utils/mcpToolRegistry.js:225-262`
  (`mcp-step9-exchange` / `resource-server-reply` precedent, built with
  `buildTokenEvent()` from `services/agentMcpTokenService.js`); UI:
  `TokenChainDisplay.jsx` event-order array (~:2810-2830, `gw-aam` at :2819),
  label map (~:2995-3010), edu-box registry (~:2389, copy
  `AamDecisionEduBox` at :2106-2118), `buildTraceSteps.js:24` `MCP_STEP_IDS`
  (slot between `mcp` and `api`), badge map `utils/pingProducts.js:79`.
  Check consumers: `ProofStrip.jsx`, `TokenChainFilmstrip.jsx`,
  `FloatingTokenChainPanel.js`, `PolicyDecisionTracePage.jsx`,
  `PersonalAgentStudioPage.jsx:41`.

## Global Constraints

- Worktree required for all edits; stage files explicitly, never `git add -A`
  (jest regenerates ~443 artifacts — do not stage them).
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`.
- `ff_rs_sideband` default `'false'` everywhere; flag OFF ⇒ byte-identical
  behavior to today (regression bar).
- Gate applies ONLY when `X-Agent-Sub` header present — browser/session
  traffic must never enter the sideband path (REGRESSION_PLAN §1: BFF
  session and UI login flows untouched).
- Sideband unreachable/timeout ⇒ fail-closed HTTP 503 for gated traffic
  (`{ error: "rs_sideband_unavailable" }`). Never fail-open (see PR #1897
  fail-open regression history).
- Do not modify: `middleware/auth.js`, token exchange services, session code,
  `agentRestrictionsGate.js` behavior.
- Server test gate: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`.
  UI test gate (Task 6 only): `cd demo_api_ui && npm run test:unit && npm run build`.
- Default demo vertical for manual validation: Super Sports.

## File Structure

- Create: `demo_api_server/services/rsSidebandClient.js` — payload build +
  HTTP dispatch to mock/real sideband, timeout, secret header.
- Create: `demo_api_server/middleware/rsSidebandGate.js` — inbound gate +
  outbound `res.json` wrapper.
- Create: `demo_api_server/tests/middleware/rsSidebandGate.test.js`
- Create: `demo_api_server/tests/services/rsSidebandClient.test.js`
- Modify: `demo_api_server/services/configStore.js` — `ff_rs_sideband` (3 sites, mirror `ff_aam`).
- Modify: `demo_api_server/server.js` — mount gate on `/api/accounts` +
  `/api/transactions` ahead of existing middleware.
- Modify: `demo_authz_server/routes/sideband.js` — banking policy rules
  (additive; existing contract tests must stay green).
- Modify: `demo_authz_server/sideband.test.js` — new rule coverage.
- Modify: `demo_api_server/utils/mcpToolRegistry.js` — emit `rs-sideband` event.
- Modify (Task 6, UI): `TokenChainDisplay.jsx`, `buildTraceSteps.js`,
  `pingProducts.js` — new step id.

---

### Task 1: Sideband client service

**Files:**
- Create: `demo_api_server/services/rsSidebandClient.js`
- Test: `demo_api_server/tests/services/rsSidebandClient.test.js`

**Interfaces:**
- Produces:
  - `buildRequestPayload(req) -> { source_ip, method, url, http_version, headers: [{name:value}], body? }`
  - `evaluateRequest(payload) -> Promise<{ decision: "permit"|"deny", response?: {response_code, headers, body}, modified?: object }>`
  - `evaluateResponse(payload) -> Promise<{ replaced: boolean, response?: object }>`
  - Env: `RS_SIDEBAND_URL` (default `http://authz-server:9001`),
    `RS_SIDEBAND_SECRET` (sent as `CLIENT-TOKEN` header),
    `RS_SIDEBAND_TIMEOUT_MS` (default `3000`).
- Consumes: nothing from other tasks.

> Before Step 1: read `demo_authz_server/routes/sideband.js` and
> `demo_authz_server/sideband.test.js`; if any field name below disagrees
> with the pinned contract, the pinned contract wins — adjust test AND
> implementation to match it.

- [ ] **Step 1: Write the failing tests**

```js
// demo_api_server/tests/services/rsSidebandClient.test.js
const nock = require("nock"); // if nock absent in deps, use jest.mock of the http helper the service uses — check package.json first
const {
  buildRequestPayload,
  evaluateRequest,
} = require("../../services/rsSidebandClient");

describe("rsSidebandClient", () => {
  afterEach(() => nock.cleanAll());

  it("builds a sideband payload with single-key header objects and echo fields", () => {
    const req = {
      method: "POST",
      protocol: "https",
      originalUrl: "/api/transactions/transfer",
      get: (h) => ({ host: "api.ping.demo:3001" }[h.toLowerCase()]),
      headers: {
        authorization: "Bearer abc",
        "x-agent-sub": "ai-agent-olb",
        "x-mcp-tool": "transfer_funds",
      },
      ip: "172.19.0.7",
      body: { amount: 8500, to: "ACCT-2231" },
    };
    const p = buildRequestPayload(req);
    expect(p.method).toBe("POST");
    expect(p.http_version).toBe("1.1");
    expect(p.url).toBe("https://api.ping.demo:3001/api/transactions/transfer");
    expect(p.source_ip).toBe("172.19.0.7");
    // array of single-key objects — pinned contract shape
    expect(p.headers).toEqual(
      expect.arrayContaining([{ authorization: "Bearer abc" }]),
    );
    expect(typeof p.body).toBe("string");
  });

  it("returns permit when reply has no response field", async () => {
    nock("http://sideband.test")
      .post("/sideband/request")
      .reply(200, { url: "https://x/y", http_version: "1.1" });
    process.env.RS_SIDEBAND_URL = "http://sideband.test";
    const out = await evaluateRequest({ method: "GET", url: "https://x/y", http_version: "1.1", headers: [] });
    expect(out.decision).toBe("permit");
  });

  it("returns deny with the verbatim direct response when response present", async () => {
    nock("http://sideband.test")
      .post("/sideband/request")
      .reply(200, {
        response: {
          response_code: "403", // string — pinned contract
          headers: [{ "content-type": "application/json" }],
          body: '{"error":"transfer_ceiling_exceeded"}',
        },
      });
    process.env.RS_SIDEBAND_URL = "http://sideband.test";
    const out = await evaluateRequest({ method: "POST", url: "https://x/t", http_version: "1.1", headers: [] });
    expect(out.decision).toBe("deny");
    expect(out.response.response_code).toBe("403");
  });

  it("rejects (throws) on network error so the gate can fail closed", async () => {
    nock("http://sideband.test").post("/sideband/request").replyWithError("boom");
    process.env.RS_SIDEBAND_URL = "http://sideband.test";
    await expect(
      evaluateRequest({ method: "GET", url: "https://x", http_version: "1.1", headers: [] }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure** —
  `cd demo_api_server && CI=true npx jest tests/services/rsSidebandClient.test.js --forceExit`
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement `services/rsSidebandClient.js`**

```js
// demo_api_server/services/rsSidebandClient.js
// Kong ping-auth-style sideband client for the last-hop resource server.
// Contract source of truth: demo_authz_server/routes/sideband.js (mock) —
// permit = reply WITHOUT a `response` field; deny/replace = reply WITH one;
// response_code is a string; headers are single-key objects.
const axios = require("axios");

const baseUrl = () => process.env.RS_SIDEBAND_URL || "http://authz-server:9001";
const timeoutMs = () => Number(process.env.RS_SIDEBAND_TIMEOUT_MS || 3000);

function toHeaderArray(headers) {
  return Object.entries(headers || {}).map(([name, value]) => ({
    [name]: Array.isArray(value) ? value.join(", ") : String(value),
  }));
}

function buildRequestPayload(req) {
  const host = req.get("host");
  const payload = {
    source_ip: req.ip,
    method: req.method,
    url: `${req.protocol}://${host}${req.originalUrl}`,
    http_version: "1.1",
    headers: toHeaderArray(req.headers),
  };
  if (req.body && Object.keys(req.body).length > 0) {
    payload.body = JSON.stringify(req.body);
  }
  return payload;
}

async function post(path, payload) {
  const headers = { "content-type": "application/json" };
  if (process.env.RS_SIDEBAND_SECRET) {
    headers["CLIENT-TOKEN"] = process.env.RS_SIDEBAND_SECRET;
  }
  const { data } = await axios.post(`${baseUrl()}${path}`, payload, {
    headers,
    timeout: timeoutMs(),
  });
  return data;
}

async function evaluateRequest(payload) {
  const data = await post("/sideband/request", payload);
  if (data && data.response) return { decision: "deny", response: data.response };
  return { decision: "permit", modified: data };
}

async function evaluateResponse(payload) {
  const data = await post("/sideband/response", payload);
  if (data && data.response) return { replaced: true, response: data.response };
  return { replaced: false };
}

module.exports = { buildRequestPayload, evaluateRequest, evaluateResponse, toHeaderArray };
```

- [ ] **Step 4: Run to verify pass** — same command. Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/rsSidebandClient.js demo_api_server/tests/services/rsSidebandClient.test.js
git commit -m "feat(bff): sideband client for last-hop resource server checkpoint"
```

---

### Task 2: Feature flag `ff_rs_sideband`

**Files:**
- Modify: `demo_api_server/services/configStore.js` (three sites — find each by grepping `ff_aam` and mirror exactly: default block ~:368, env mapping ~:1158, second env site ~:2188)
- Test: extend an existing configStore flag test file (grep `ff_aam` under `demo_api_server/tests/` and add the new flag beside it)

**Interfaces:**
- Produces: `configStore.getFlag("ff_rs_sideband")` (same accessor the codebase
  already uses for `ff_aam` — copy the exact accessor pattern found at the
  `ff_agent_restrictions` call site in `middleware/agentRestrictionsGate.js:108-210`).
- Consumes: nothing.

- [ ] **Step 1: Failing test** — in the located flag test file, add:

```js
it("ff_rs_sideband defaults to 'false' and maps FF_RS_SIDEBAND", () => {
  // copy the existing ff_aam assertion pair exactly, swapping names
});
```

(Write the real assertions by copying the neighboring `ff_aam` case — the
helper-based mock setup in that file is mandatory; hand-rolled configStore
mocks break, see memory note "Mocks: configStore + introspection".)

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Add the flag at the three mirrored sites, default `'false'`, env `FF_RS_SIDEBAND`.**
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** (expect the pre-commit hook to regenerate
  `mcp-tool-schemas.json` — include it if the hook stages it, that is normal).

---

### Task 3: Inbound gate middleware

**Files:**
- Create: `demo_api_server/middleware/rsSidebandGate.js`
- Test: `demo_api_server/tests/middleware/rsSidebandGate.test.js`
- Modify: `demo_api_server/server.js` — insert `rsSidebandGate` immediately
  BEFORE the existing middleware chain on the `/api/accounts` and
  `/api/transactions` mounts (locate the mounts near `server.js:1314-1353`;
  order after change: `rsSidebandGate` → `authenticateToken` →
  `requireScopes` → `agentRestrictionsGate` → handler).

**Interfaces:**
- Consumes: Task 1 `buildRequestPayload` / `evaluateRequest`; Task 2 flag accessor.
- Produces: `rsSidebandGate(req, res, next)` Express middleware (default export
  style must match `agentRestrictionsGate.js` — check whether it exports the
  function directly or a factory, and mirror it). Attaches
  `req.rsSideband = { decision, elapsedMs }` for Task 5's event emission.

- [ ] **Step 1: Failing tests**

```js
// demo_api_server/tests/middleware/rsSidebandGate.test.js
const express = require("express");
const request = require("supertest");

jest.mock("../../services/rsSidebandClient", () => ({
  buildRequestPayload: jest.fn(() => ({ method: "GET", url: "u", http_version: "1.1", headers: [] })),
  evaluateRequest: jest.fn(),
}));
// Mock the flag accessor the same way the agentRestrictionsGate tests do —
// copy their configStore mock helper import verbatim.
const { evaluateRequest } = require("../../services/rsSidebandClient");
const rsSidebandGate = require("../../middleware/rsSidebandGate");

function appWithGate() {
  const app = express();
  app.use(express.json());
  app.use(rsSidebandGate);
  app.get("/api/accounts/my/balance", (req, res) => res.json({ ok: true }));
  return app;
}

describe("rsSidebandGate", () => {
  // In each case set the flag mock: on unless stated.

  it("passes non-agent traffic through untouched (no sideband call)", async () => {
    const res = await request(appWithGate()).get("/api/accounts/my/balance");
    expect(res.status).toBe(200);
    expect(evaluateRequest).not.toHaveBeenCalled();
  });

  it("skips entirely when ff_rs_sideband is off, even for agent traffic", async () => {
    // flag mock -> "false"
    const res = await request(appWithGate())
      .get("/api/accounts/my/balance")
      .set("X-Agent-Sub", "ai-agent-olb");
    expect(res.status).toBe(200);
    expect(evaluateRequest).not.toHaveBeenCalled();
  });

  it("permits agent traffic on permit decision and records req.rsSideband", async () => {
    evaluateRequest.mockResolvedValue({ decision: "permit" });
    const res = await request(appWithGate())
      .get("/api/accounts/my/balance")
      .set("X-Agent-Sub", "ai-agent-olb");
    expect(res.status).toBe(200);
  });

  it("relays a deny verbatim: status from string response_code, headers, body", async () => {
    evaluateRequest.mockResolvedValue({
      decision: "deny",
      response: {
        response_code: "403",
        headers: [{ "content-type": "application/json" }],
        body: '{"error":"transfer_ceiling_exceeded"}',
      },
    });
    const res = await request(appWithGate())
      .get("/api/accounts/my/balance")
      .set("X-Agent-Sub", "ai-agent-olb");
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toBe("transfer_ceiling_exceeded");
  });

  it("fails CLOSED with 503 rs_sideband_unavailable when sideband errors", async () => {
    evaluateRequest.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(appWithGate())
      .get("/api/accounts/my/balance")
      .set("X-Agent-Sub", "ai-agent-olb");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("rs_sideband_unavailable");
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `middleware/rsSidebandGate.js`**

```js
// demo_api_server/middleware/rsSidebandGate.js
// Kong-mock inbound checkpoint: agent traffic only, flag-gated, fail-closed.
// Order on the route: rsSidebandGate -> authenticateToken -> requireScopes ->
// agentRestrictionsGate. This gate never re-validates upstream tokens; the
// raw Authorization header travels inside the sideband payload and PingOne
// Authorize validates the step-9 token itself.
const { buildRequestPayload, evaluateRequest } = require("../services/rsSidebandClient");
// flag accessor: same import agentRestrictionsGate.js uses — mirror it exactly

function applyDirectResponse(res, response) {
  const status = parseInt(response.response_code, 10) || 500;
  for (const h of response.headers || []) {
    const [name] = Object.keys(h);
    res.set(name, h[name]);
  }
  res.status(status);
  // body is a JSON string per contract; send raw so it relays byte-for-byte
  res.send(response.body ?? "");
}

async function rsSidebandGate(req, res, next) {
  if (!req.get("X-Agent-Sub")) return next();
  if (getFlag("ff_rs_sideband") !== "true") return next(); // accessor per Task 2
  const started = Date.now();
  try {
    const outcome = await evaluateRequest(buildRequestPayload(req));
    req.rsSideband = { decision: outcome.decision, elapsedMs: Date.now() - started };
    if (outcome.decision === "deny") return applyDirectResponse(res, outcome.response);
    return next();
  } catch (err) {
    req.rsSideband = { decision: "error", elapsedMs: Date.now() - started };
    return res.status(503).json({ error: "rs_sideband_unavailable" });
  }
}

module.exports = rsSidebandGate;
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Mount in `server.js`** ahead of the accounts/transactions
  chains; then run the FULL server suite:
  `CI=true npm test -- --forceExit --maxWorkers=4` — flag defaults off, so
  zero existing tests may change outcome (flake rule: rerun any failure in
  isolation before blaming the change).
- [ ] **Step 6: Commit.**

---

### Task 4: Outbound redaction leg

**Files:**
- Modify: `demo_api_server/middleware/rsSidebandGate.js` (wrap `res.json` when
  inbound leg permitted)
- Test: extend `demo_api_server/tests/middleware/rsSidebandGate.test.js`

**Interfaces:**
- Consumes: Task 1 `evaluateResponse`.
- Produces: transparent response rewrite — handlers unchanged.

- [ ] **Step 1: Failing tests**

```js
it("applies outbound replacement body on 2xx (redaction)", async () => {
  evaluateRequest.mockResolvedValue({ decision: "permit" });
  evaluateResponse.mockResolvedValue({
    replaced: true,
    response: {
      response_code: "200",
      headers: [{ "content-type": "application/json" }],
      body: '[{"account":"****2231"}]',
    },
  });
  const res = await request(appWithGate())
    .get("/api/accounts/my/balance")
    .set("X-Agent-Sub", "ai-agent-olb");
  expect(res.status).toBe(200);
  expect(res.body[0].account).toBe("****2231");
});

it("skips the outbound leg on non-2xx and when replaced=false passes body through", async () => {
  evaluateRequest.mockResolvedValue({ decision: "permit" });
  evaluateResponse.mockResolvedValue({ replaced: false });
  const res = await request(appWithGate())
    .get("/api/accounts/my/balance")
    .set("X-Agent-Sub", "ai-agent-olb");
  expect(res.body.ok).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** — inside the permit branch of `rsSidebandGate`,
  monkey-patch `res.json` before `next()`:

```js
const originalJson = res.json.bind(res);
res.json = (payload) => {
  if (res.statusCode < 200 || res.statusCode >= 300) return originalJson(payload);
  const outboundPayload = {
    method: req.method,
    url: buildRequestPayload(req).url,
    http_version: "1.1",
    response_code: String(res.statusCode),
    headers: [{ "content-type": "application/json" }],
    body: JSON.stringify(payload),
  };
  evaluateResponse(outboundPayload)
    .then((out) =>
      out.replaced ? res.send(out.response.body) : originalJson(payload),
    )
    .catch(() => originalJson(payload)); // outbound leg is enhancement, inbound already permitted — pass through on error
  return res;
};
```

  (Async caveat: `res.json` returning before the promise settles is fine for
  Express, but supertest sees the response only when `send` fires — the tests
  in Step 1 verify this works. Keep the outbound-error path pass-through, NOT
  fail-closed: the authorization decision already happened inbound.)

- [ ] **Step 4: Run to verify pass; full server suite again.**
- [ ] **Step 5: Commit.**

---

### Task 5: Mock policy content + Token Chain event

**Files:**
- Modify: `demo_authz_server/routes/sideband.js` — add banking rules for the
  four shipped UI scenarios (additive; existing echo/health behavior intact):
  1. `POST */api/transactions/transfer` with body `amount > 5000` and
     `x-agent-sub` header ⇒ deny `403` `{"error":"transfer_ceiling_exceeded", "detail":"Agent transfers are capped at $5,000. Ask the account owner to approve or raise the limit."}`
  2. `GET */api/accounts/*/details` where the bearer token's scopes (decode
     JWT payload only — no signature check in the mock) lack `sensitive:read`
     ⇒ deny `403` `{"error":"insufficient_scope","scope":"sensitive:read"}`
  3. response leg: body containing `"account":"<digits-dashes>"` ⇒ replace
     with masked `"****"+last4`
  4. everything else ⇒ permit (echo `url` + `http_version`, no `response`)
- Test: `demo_authz_server/sideband.test.js` — one case per rule, plus the
  pre-existing contract cases untouched.
- Modify: `demo_api_server/utils/mcpToolRegistry.js` — after the banking API
  reply arrives, when the response carries the marker header the gate sets
  (add `res.set("X-RS-Sideband", req.rsSideband.decision)` in Task 3/4 gate;
  `BankingAPIClient` responses expose headers), emit a `rs-sideband` token
  event via `buildTokenEvent()` next to the existing `resource-server-reply`
  emission (~:225-262), payload: `{ decision, elapsedMs }`.
- Test: extend the existing mcpToolRegistry event test (grep
  `resource-server-reply` under `demo_api_server/tests/`).

Steps: same TDD cycle as prior tasks (failing test → red → implement → green →
full `demo_authz_server` suite `CI=true npm test` in that dir → commit).

---

### Task 6: Token Chain UI step

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx` — add
  `"rs-sideband"` to the event-order array after `resource-server-reply`'s
  predecessor block (~:2810-2830); label map entry
  `"rs-sideband": "RS Sideband Check"` (~:2995-3010); edu box: copy
  `AamDecisionEduBox` (~:2106-2118) as `RsSidebandEduBox` with copy:
  "The last-hop resource server asked PingOne Authorize over the AAM
  sideband before touching data — the same check a Kong ping-auth plugin
  would make. Deny = the policy's own response, relayed verbatim." Register
  in the edu-box registry (~:2389).
- Modify: `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js:24` —
  insert `"rs-sideband"` between `"mcp"` and `"api"` in `MCP_STEP_IDS`; add
  `STEP_SPEC` (~:87) and `STEP_RFCS` (~:73) entries (RFC: none — cite
  "PingOne Authorize AAM sideband").
- Modify: `demo_api_ui/src/utils/pingProducts.js:79` — badge map
  `'rs-sideband': 'p1az'` (verify the exact product-key vocabulary used by
  neighboring entries first; `gw-aam` is the precedent to copy).
- Test: extend the UI test that pins the event-order/label maps (grep
  `resource-server-reply` under `demo_api_ui/src` tests) + check
  `ProofStrip.jsx` / `TokenChainFilmstrip.jsx` render unknown-step-safe.

Steps: TDD cycle, then the UI gate:
`cd demo_api_ui && npm run test:unit && npm run build` — both must exit 0.
Manual: Super Sports vertical, balance chip with `FF_RS_SIDEBAND=true` on the
stack, confirm the new card renders in Token Chain and in Filmstrip/ProofStrip
without layout overflow, both themes.

---

### Task 7 (optional, separate PR): Real PingOne AAM provisioning

Doc + config only — no demo code path changes:
- Create the API service via Management API (**`apiServers`**, not
  "apiServices"): base URL `https://api.ping.demo:3001/api`, operations for
  `GET /accounts/*`, `POST /transactions/transfer`.
- Generate custom policies with the `p1az-import-generator` skill (import
  file, never hand-edit the console — standing rule).
- Point `RS_SIDEBAND_URL=https://http-access-api.pingone.com/v1/environments/<envId>`
  + `RS_SIDEBAND_SECRET=<gateway credential>` in `demo_api_server/.env`
  (per-service .env is what the BFF reads — not repo root).
- Recreate (not restart) `demo-api-server` container so env bakes in:
  `docker compose up -d demo-api-server`.

---

## Done criteria (whole plan)

1. `FF_RS_SIDEBAND` unset/false: full server + UI suites green, zero
   behavioral diff (evidence: suite output).
2. Flag on + mock sideband: agent balance chip ⇒ PERMIT card `rs-sideband`
   in Token Chain; transfer $8,500 chip ⇒ 403 `transfer_ceiling_exceeded`
   surfaced as the agent's tool error; sensitive-details tool without
   `sensitive:read` ⇒ 403; transactions list shows masked `****` account.
3. authz-server stopped, flag on: agent calls get 503
   `rs_sideband_unavailable` (fail-closed proof); browser traffic unaffected.
4. Checkpoint UI page scenarios now match reality 1:1 (page itself may stay
   canned — parity check is manual).
5. Every gate command output pasted in the PR body.
