# AAM End-to-End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PingOne Authorize API Access Management decisions visible in the demo's token chain, runnable against a real or mock Sideband backend, and switchable by a feature flag.

**Architecture:** The IG route added in PR #1025 keeps using the stock `PingAuthorizeFilter`, but its `sidebandHandler` is replaced with a Chain containing one Groovy filter that both retargets the Sideband call (real PingOne vs the `demo_authz_server` mock, chosen by the existing `X-Authz-Simulated` header) and captures the request/response JSON. A second Groovy filter stamps that capture into the existing `X-Gw-Audit-Trail` header as an `aam` section, which the BFF already knows how to parse and the UI already knows how to render.

**Tech Stack:** PingGateway (IG) Groovy `ScriptableFilter`; Node/Express (`demo_authz_server`, `demo_api_server`) with jest; React with vitest (`demo_api_ui`); PingOne Management API.

## Global Constraints

- Worktree required for all edits. A hard-block hook denies `Write`/`Edit` in the main checkout. Stage explicitly with `git add <files>`, never `git add -A`.
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else is plain text, CSS, or semantic HTML.
- Do not modify `p1az-decision.groovy` or any existing route file. AAM is additive.
- `demo_api_server/.env` contains a malformed line that breaks shell sourcing and silently empties `PINGONE_ENVIRONMENT_ID`. Read values with a targeted `grep`, never `. .env`.
- The IG token resolver scans **every string in a route file, comments included**. Never write a bare `&`+`{` sequence in prose there — it resolves to an empty key and fails route build with `key can't be empty`.
- Never run jest with `git add -A` afterwards: the BFF suite rewrites ~443 files under `demo_api_server/data/**`. Restore unintended changes before staging.
- Verify Groovy/route changes on an **isolated** IG container (distinct name, port 3037, joined to `ai-demo_ai-demo`), never by repointing the running stack.

---

## Reference: the Sideband wire contract

Recorded live on 2026-07-27. Both filters and the mock depend on this.

Request — `POST {serviceUrl}/sideband/request`, gateway credential in a `CLIENT-TOKEN` header:

```json
{
  "source_ip": "192.168.97.1",
  "source_port": 56782,
  "method": "GET",
  "url": "http://api.ping.demo:3036/aam/health",
  "http_version": "1.1",
  "headers": [ { "Accept": "*/*" }, { "Authorization": "Bearer …" } ]
}
```

Response — echoes those fields, and adds `response` **only to deny**:

```json
{
  "source_ip": "192.168.97.1",
  "source_port": 56782,
  "method": "GET",
  "url": "http://api.ping.demo:3036/aam/health",
  "http_version": "1.1",
  "headers": [ { "Accept": "*/*" } ],
  "response": {
    "response_code": "401",
    "response_status": "Unauthorized",
    "http_version": "1.1",
    "headers": [ { "www-authenticate": "Bearer realm=\"…\", error=\"invalid_token\"" } ]
  }
}
```

Rules that cost debugging time and must not be violated:

- `response` absent = **allow**; present = **deny**, return that status to the client.
- `response_code` is a **string** (`"401"`), not a number.
- `headers` is an **array of single-key objects**, not a map. A map fails in `SidebandApiFilter.fillHeadersFromJson` with a null-map NPE.
- Omitting `url` fails in the URI parser; omitting `http_version` fails in `toCommonsHttpVersion`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `ping-gateway/scripts/groovy/aam-sideband-capture.groovy` | Retarget the Sideband call and capture request/response JSON onto the exchange |
| `ping-gateway/scripts/groovy/aam-trail-stamp.groovy` | Read the capture, stamp `X-Gw-Audit-Trail` with an `aam` section |
| `ping-gateway/config/routes/04-aam-api-access.json` | Wire both filters; `sidebandHandler` Chain |
| `demo_authz_server/routes/sideband.js` | Mock Sideband endpoint implementing the contract above |
| `demo_authz_server/sideband.test.js` | Mock contract tests |
| `demo_api_server/routes/aamProbe.js` | `GET /api/aam/probe` — calls the gateway, returns the parsed decision |
| `demo_api_server/tests/aamProbe.test.js` | Probe route + flag-state tests |
| `demo_api_server/services/mcpGatewayClient.js` | `parseGwAuditTrail` gains an `aam` branch |
| `demo_api_server/services/configStore.js` | `ff_aam` at three sites |
| `demo_api_ui/src/components/TokenChainDisplay.js` | `gw-aam` renderer, event-id list entry, label-map entry |

---

## Task 0: Provision PingOne (already done — verify only)

**Files:** none.

**Interfaces:**
- Produces: environment objects consumed by every later task's live verification.

Phase 0 was executed on 2026-07-27 against environment `01d89b06`. This task
confirms the objects still exist rather than recreating them.

| Object | Id |
| --- | --- |
| Gateway `PingGateway AAM` (`API_GATEWAY_INTEGRATION`) | `737420bd-d898-4af1-830c-d7452e5494fa` |
| Gateway credential | `5fc12c5b-56c4-4d9e-870d-3785d8b27cbb` |
| Resource `Demo AAM` (aud `https://api.ping.demo:3036/aam`) | `93178f39-a0ec-48d7-86f8-7ec92f3f1303` |
| API server `PingGateway AAM Demo` (base `http://api.ping.demo:3036`), deployed | `fbf63ae6-616b-4ab3-9ac6-d088b90dfa5e` |
| Operation `AAM health probe` — `GET /aam/health`, rule = group `Full access` | `5830c573-d81d-4b66-b950-152d5deb2276` |
| Group `Full access` | `085b2810-c88c-4a4e-815b-f5beb385c73f` |

- [ ] **Step 1: Verify the objects exist**

```bash
python3 - <<'PY'
import base64, json, urllib.request, urllib.parse
ENVFILE="demo_api_server/.env"
def envval(k):
    for line in open(ENVFILE, errors="replace"):
        if line.startswith(k+"="): return line.split("=",1)[1].strip().strip('"').strip("'")
    return ""
envid=envval("PINGONE_ENVIRONMENT_ID")
basic=base64.b64encode(f'{envval("PINGONE_WORKER_CLIENT_ID")}:{envval("PINGONE_WORKER_CLIENT_SECRET")}'.encode()).decode()
req=urllib.request.Request(f"https://auth.pingone.com/{envid}/as/token",
    data=urllib.parse.urlencode({"grant_type":"client_credentials"}).encode(),
    headers={"Authorization":"Basic "+basic,"Content-Type":"application/x-www-form-urlencoded"})
tok=json.load(urllib.request.urlopen(req))["access_token"]
base=f"https://api.pingone.com/v1/environments/{envid}"
for path in ("gateways","apiServers","groups?filter=name%20eq%20%22Full%20access%22"):
    r=urllib.request.Request(f"{base}/{path}"); r.add_header("Authorization","Bearer "+tok)
    d=json.load(urllib.request.urlopen(r))
    print(path.split("?")[0], "->", d.get("count", len(d.get("_embedded",{}).get(path.split("?")[0],[]))))
PY
```

Expected: `gateways -> 1`, `apiServers -> 1`, `groups -> 1`. If any is 0, re-create it using the calls recorded in the spec's "Phase 0" section.

- [ ] **Step 2: Record the credential locally (never commit it)**

The credential secret is returned **only** by `POST /gateways/{id}/credentials`. If
it was not saved, mint a new one and delete the old. Put it in
`ping-gateway/.env` (gitignored):

```bash
PG_AAM_SERVICE_URL=https://http-access-api.pingone.com/v1/environments/<envId>
AAM_GATEWAY_SECRET=<credential verbatim — NOT base64>
AAM_MOCK_BASE=http://authz-server:9001
```

- [ ] **Step 3: Confirm the live path answers**

```bash
docker restart ai-demo-ping-gateway
curl -i -m 25 http://api.ping.demo:3036/aam/health
```

Expected: `401` with `WWW-Authenticate: Bearer realm="http://api.ping.demo:3036/", error="invalid_token"`. That realm echoing the registered base URL is the proof AAM matched the API service.

---

## Task 1: Capture and stamp filters

**Files:**
- Create: `ping-gateway/scripts/groovy/aam-sideband-capture.groovy`
- Create: `ping-gateway/scripts/groovy/aam-trail-stamp.groovy`
- Modify: `ping-gateway/config/routes/04-aam-api-access.json`
- Modify: `ping-gateway/.env.example`

**Interfaces:**
- Consumes: the environment from Task 0.
- Produces: response header `X-Gw-Audit-Trail` whose JSON has an `aam` object with keys `decision` (`"PERMIT"`/`"DENY"`), `backend` (`"real"`/`"mock"`), `serviceUri`, `elapsedMs`, `request`, `response`. Task 3 parses exactly these names.

- [ ] **Step 1: Write the capture filter**

Create `ping-gateway/scripts/groovy/aam-sideband-capture.groovy`:

```groovy
// ping-gateway/scripts/groovy/aam-sideband-capture.groovy
//
// Sits inside PingAuthorizeFilter's sidebandHandler, directly on the wire
// between the filter and the PingOne Authorize Sideband API. It does two jobs
// that have to happen in the same place:
//
//   1. Retarget — X-Authz-Simulated (set by the BFF, value = effective
//      ff_authorize_simulated) selects the mock instead of real PingOne.
//      gatewayServiceUri cannot do this: IG resolves it once at config load.
//   2. Capture — record the Sideband request and response JSON so
//      aam-trail-stamp.groovy can put them in X-Gw-Audit-Trail.
//
// SECURITY: the Sideband request body contains the caller's Authorization
// header, because that is what AAM evaluates. Redact before storing — the
// capture travels to a browser via the audit-trail header.
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.util.promise.Promises

def SENSITIVE = ['authorization', 'cookie', 'set-cookie', 'client-token']

// headers arrive as an array of single-key objects: [{"Accept":"*/*"}, ...]
def redactHeaders = { list ->
    if (!(list instanceof List)) return list
    list.collect { entry ->
        if (!(entry instanceof Map)) return entry
        entry.collectEntries { k, v ->
            [(k), (SENSITIVE.contains(String.valueOf(k).toLowerCase()) ? '<redacted>' : v)]
        }
    }
}

def redactBody = { obj ->
    if (!(obj instanceof Map)) return obj
    def copy = new LinkedHashMap(obj)
    if (copy.containsKey('headers')) copy.headers = redactHeaders(copy.headers)
    if (copy.response instanceof Map && copy.response.headers != null) {
        def r = new LinkedHashMap(copy.response)
        r.headers = redactHeaders(r.headers)
        copy.response = r
    }
    return copy
}

def trustedCaller = System.getenv('BFF_INTERNAL_SECRET') &&
    request.headers.getFirst('X-BFF-Internal') == System.getenv('BFF_INTERNAL_SECRET')
def simulated = trustedCaller && request.headers.getFirst('X-Authz-Simulated') == 'true'

def mockBase = System.getenv('AAM_MOCK_BASE') ?: ''
if (simulated && mockBase) {
    // Keep the path (/sideband/request) the filter already built; swap the origin.
    def originalUri = request.uri.toString()
    def suffix = originalUri.substring(originalUri.indexOf('/sideband'))
    request.uri = new java.net.URI(mockBase + suffix)
}

def started = System.currentTimeMillis()
def reqJson = null
try {
    reqJson = new JsonSlurper().parseText(request.entity.string ?: '{}')
} catch (Exception e) {
    logger.warn('[AamCapture] could not parse sideband request: ' + e.message)
}

return next.handle(context, request).thenOnResult({ resp ->
    def respJson = null
    try {
        respJson = new JsonSlurper().parseText(resp.entity.string ?: '{}')
    } catch (Exception e) {
        logger.warn('[AamCapture] could not parse sideband response: ' + e.message)
    }
    // The discriminator: a `response` object means AAM wants us to answer now.
    def decision = (respJson instanceof Map && respJson.response != null) ? 'DENY' : 'PERMIT'
    attributes['aamTrail'] = [
        decision  : decision,
        backend   : simulated ? 'mock' : 'real',
        serviceUri: request.uri.toString(),
        elapsedMs : System.currentTimeMillis() - started,
        request   : redactBody(reqJson),
        response  : redactBody(respJson),
    ]
})
```

- [ ] **Step 2: Write the stamp filter**

Create `ping-gateway/scripts/groovy/aam-trail-stamp.groovy`:

```groovy
// ping-gateway/scripts/groovy/aam-trail-stamp.groovy
//
// Runs on the outer route, after PingAuthorizeFilter has produced its verdict.
// Reads what aam-sideband-capture.groovy stored and emits it as the `aam`
// section of X-Gw-Audit-Trail — the same header p1az-decision.groovy uses, so
// the BFF and token chain need no second mechanism.
//
// Must stamp on BOTH outcomes: the 403 deny as well as the allowed 200.
// FAIL-SAFE: never throw. Losing this header costs the chain its gw-aam event,
// but must not cost the request.
import groovy.json.JsonOutput

return next.handle(context, request).thenOnResult({ response ->
    try {
        def trail = attributes['aamTrail']
        if (trail != null) {
            response.headers.put('X-Gw-Audit-Trail', [JsonOutput.toJson([aam: trail])])
        }
    } catch (Exception e) {
        logger.warn('[AamTrailStamp] could not stamp audit trail: ' + e.message)
    }
})
```

- [ ] **Step 3: Wire both filters into the route**

In `ping-gateway/config/routes/04-aam-api-access.json`, add `sidebandHandler` to the `PingAuthorizeFilter` config and put `AamTrailStamp` first in the filter list:

```json
{
  "name": "AamTrailStamp",
  "type": "ScriptableFilter",
  "config": { "type": "application/x-groovy", "file": "aam-trail-stamp.groovy" }
},
{
  "name": "AamDecision",
  "type": "PingAuthorizeFilter",
  "config": {
    "gatewayServiceUri": "&{pg.aam.service.url|https://aam-not-configured.invalid}",
    "secretsProvider": "SecretsStore",
    "gatewayCredentialSecretId": "aam.gateway.secret",
    "sidebandHandler": {
      "type": "Chain",
      "config": {
        "filters": [
          {
            "name": "AamSidebandCapture",
            "type": "ScriptableFilter",
            "config": { "type": "application/x-groovy", "file": "aam-sideband-capture.groovy" }
          }
        ],
        "handler": "ClientHandler"
      }
    }
  }
}
```

- [ ] **Step 4: Document `AAM_MOCK_BASE`**

Append to the AAM block in `ping-gateway/.env.example`:

```bash
# Mock Sideband backend (demo_authz_server). Selected per request when the BFF
# sends X-Authz-Simulated: true, mirroring P1AZ_MOCK_BASE / P1AZ_REAL_BASE.
AAM_MOCK_BASE=http://authz-server:9001
```

- [ ] **Step 5: Verify on an isolated gateway**

```bash
cd /Users/cmuir/Development/AI-DEMO2
docker rm -f aam-verify 2>/dev/null
docker run -d --name aam-verify --network ai-demo_ai-demo -p 3037:8080 \
  --env-file ./ping-gateway/.env \
  -e PG_API_RESOURCE_SERVER_URL=http://api-resource-server:8082 \
  -v "$PWD/.claude/worktrees/<wt>/ping-gateway/config:/var/gateway/config:ro" \
  -v "$PWD/.claude/worktrees/<wt>/ping-gateway/scripts/groovy:/var/gateway/scripts/groovy:ro" \
  -v "$PWD/mcp-tool-schemas.json:/var/gateway/config/mcp-tool-schemas.json:ro" \
  -v "$PWD/certs:/certs:ro" \
  --entrypoint /bin/sh us-docker.pkg.dev/forgeops-public/images-base/ig:latest \
  -c 'rm -f /var/gateway/tmp/ig.pid; exec /opt/gateway/bin/start.sh /var/gateway'
until docker logs aam-verify 2>&1 | grep -q "verticles started"; do sleep 2; done
curl -sD- -o /dev/null -m 25 -H "Host: api.ping.demo:3036" http://localhost:3037/aam/health | grep -i "x-gw-audit-trail"
```

Expected: an `x-gw-audit-trail` header whose JSON contains `"aam"` with `"decision":"DENY"` and a `request` whose `Authorization` header reads `<redacted>`.

**This step also settles the spec's one structural risk** — whether the nested `sidebandHandler` chain shares `AttributesContext` with the outer route. If `attributes['aamTrail']` is null in the stamp filter, switch the hand-off: have the capture filter set a header on the inner response and have the stamp filter read and remove it.

- [ ] **Step 6: Confirm no regression, then commit**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3037/health          # expect 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3037/mcp  # expect 401
docker logs aam-verify 2>&1 | grep -c "error occurred while building"           # expect 0
docker rm -f aam-verify
git add ping-gateway/scripts/groovy/aam-sideband-capture.groovy \
        ping-gateway/scripts/groovy/aam-trail-stamp.groovy \
        ping-gateway/config/routes/04-aam-api-access.json ping-gateway/.env.example
git commit -m "feat(aam): capture the Sideband exchange into X-Gw-Audit-Trail"
```

---

## Task 2: Mock Sideband endpoint

**Files:**
- Create: `demo_authz_server/routes/sideband.js`
- Create: `demo_authz_server/sideband.test.js`
- Modify: `demo_authz_server/index.js`

**Interfaces:**
- Consumes: the wire contract above.
- Produces: `POST /sideband/request` on `authz-server:9001`, honouring `AAM_MOCK_REQUIRED_GROUP` (default `Full access`).

- [ ] **Step 1: Write the failing tests**

Create `demo_authz_server/sideband.test.js`:

```javascript
'use strict';
const request = require('supertest');
const app = require('./index');

const baseReq = (headers) => ({
  source_ip: '192.168.97.1',
  source_port: 56782,
  method: 'GET',
  url: 'http://api.ping.demo:3036/aam/health',
  http_version: '1.1',
  headers,
});

// group claim lives in the token; the mock reads a demo header instead of
// verifying a signature — it is a stand-in for PingOne, not a token service.
describe('mock Sideband API', () => {
  test('permits when the required group is present: no response object', async () => {
    const res = await request(app)
      .post('/sideband/request')
      .send(baseReq([{ 'X-Demo-Groups': 'Full access' }]));
    expect(res.status).toBe(200);
    expect(res.body.response).toBeUndefined();
    expect(res.body.url).toBe('http://api.ping.demo:3036/aam/health');
    expect(res.body.http_version).toBe('1.1');
    expect(Array.isArray(res.body.headers)).toBe(true);
  });

  test('denies when the group is absent: response object with string code', async () => {
    const res = await request(app)
      .post('/sideband/request')
      .send(baseReq([{ Accept: '*/*' }]));
    expect(res.status).toBe(200);
    expect(res.body.response.response_code).toBe('403');
    expect(typeof res.body.response.response_code).toBe('string');
    expect(res.body.response.response_status).toBe('Forbidden');
    expect(Array.isArray(res.body.response.headers)).toBe(true);
  });

  test('echoes the request fields the gateway requires', async () => {
    const res = await request(app)
      .post('/sideband/request')
      .send(baseReq([{ Accept: '*/*' }]));
    for (const k of ['source_ip', 'source_port', 'method', 'url', 'http_version', 'headers']) {
      expect(res.body).toHaveProperty(k);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_authz_server && npx jest sideband.test.js`
Expected: FAIL — 404 from an unmounted route.

- [ ] **Step 3: Implement the mock**

Create `demo_authz_server/routes/sideband.js`:

```javascript
'use strict';

/**
 * POST /sideband/request
 *
 * Mock of the PingOne Authorize Sideband API, so AAM is demonstrable without a
 * live PingOne environment. Contract recorded from the real service 2026-07-27:
 * the response ECHOES the request and adds a `response` object ONLY to deny.
 * `response_code` is a string; `headers` is an array of single-key objects.
 *
 * Deliberately thin: it is a stand-in for PingOne, not a policy engine or a
 * token service. It reads the demo group header rather than verifying a JWT.
 */

const REQUIRED_GROUP = process.env.AAM_MOCK_REQUIRED_GROUP || 'Full access';

function headerValue(headers, name) {
  if (!Array.isArray(headers)) return '';
  const wanted = name.toLowerCase();
  for (const entry of headers) {
    if (!entry || typeof entry !== 'object') continue;
    for (const [k, v] of Object.entries(entry)) {
      if (k.toLowerCase() === wanted) return String(v);
    }
  }
  return '';
}

module.exports = function sideband(req, res) {
  const body = req.body || {};
  const groups = headerValue(body.headers, 'X-Demo-Groups')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean);

  // Echo every field the gateway needs back, unchanged.
  const echoed = {
    source_ip: body.source_ip,
    source_port: body.source_port,
    method: body.method,
    url: body.url,
    http_version: body.http_version,
    headers: Array.isArray(body.headers) ? body.headers : [],
  };

  if (groups.includes(REQUIRED_GROUP)) {
    return res.status(200).json(echoed); // no `response` => allow
  }

  return res.status(200).json({
    ...echoed,
    response: {
      response_code: '403',
      response_status: 'Forbidden',
      http_version: '1.1',
      headers: [
        { 'content-length': '0' },
        { 'x-aam-mock-rule': `member of ${REQUIRED_GROUP}` },
      ],
    },
  });
};
```

- [ ] **Step 4: Mount it**

In `demo_authz_server/index.js`, beside the other `app.post` mounts:

```javascript
app.post('/sideband/request', wrap(require('./routes/sideband')));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd demo_authz_server && npx jest sideband.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify the gateway drives the mock**

Restart the isolated gateway from Task 1 Step 5 with `-e AAM_MOCK_BASE=http://authz-server:9001`, then:

```bash
curl -sD- -o /dev/null -m 25 -H "Host: api.ping.demo:3036" \
  -H "X-Authz-Simulated: true" -H "X-BFF-Internal: $(grep -m1 '^BFF_INTERNAL_SECRET=' ping-gateway/.env | cut -d= -f2)" \
  http://localhost:3037/aam/health | grep -i "x-gw-audit-trail"
```

Expected: the trail's `aam.backend` is `"mock"` and `aam.decision` is `"DENY"`.

- [ ] **Step 7: Commit**

```bash
git add demo_authz_server/routes/sideband.js demo_authz_server/sideband.test.js demo_authz_server/index.js
git commit -m "feat(aam): mock Sideband endpoint for simulated mode"
```

---

## Task 3: BFF trail parsing and probe route

**Files:**
- Modify: `demo_api_server/services/mcpGatewayClient.js`
- Create: `demo_api_server/routes/aamProbe.js`
- Create: `demo_api_server/tests/aamProbe.test.js`
- Modify: `demo_api_server/server.js` (mount)

**Interfaces:**
- Consumes: `X-Gw-Audit-Trail` with the `aam` section from Task 1, and `configStore.getEffective('ff_aam')` from Task 4.
- Produces: `GET /api/aam/probe` returning `{ ok, decision, backend, elapsedMs, request, response }`. Task 5 renders these fields.

> **Run Task 4 before this task.** The probe route reads `ff_aam`, and an
> unregistered flag makes `getEffective` return undefined, so every probe would
> answer `disabled` and Step 5's verification would pass for the wrong reason.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/aamProbe.test.js`:

```javascript
'use strict';
const { parseGwAuditTrail } = require('../services/mcpGatewayClient');

describe('parseGwAuditTrail — aam section', () => {
  test('extracts the aam section', () => {
    const header = JSON.stringify({
      aam: {
        decision: 'DENY', backend: 'mock', elapsedMs: 12,
        serviceUri: 'http://authz-server:9001/sideband/request',
        request: { method: 'GET' },
        response: { response: { response_code: '403' } },
      },
    });
    const trail = parseGwAuditTrail(header);
    expect(trail.aam.decision).toBe('DENY');
    expect(trail.aam.backend).toBe('mock');
  });

  test('returns null for malformed JSON instead of throwing', () => {
    expect(parseGwAuditTrail('{not json')).toBeNull();
  });

  test('tolerates a trail with no aam section', () => {
    const trail = parseGwAuditTrail(JSON.stringify({ authorize: { decision: 'PERMIT' } }));
    expect(trail.aam).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/aamProbe.test.js --forceExit`
Expected: FAIL if `parseGwAuditTrail` is not exported. `CI=true` is required — without it the supertest suites flake.

- [ ] **Step 3: Export the parser and add the probe route**

Ensure `parseGwAuditTrail` is exported from `mcpGatewayClient.js`. It already parses the header generically, so the `aam` key needs no special-casing beyond being reachable.

Create `demo_api_server/routes/aamProbe.js`:

```javascript
'use strict';

/**
 * GET /api/aam/probe
 *
 * /aam is called directly by clients, so nothing in the BFF normally receives
 * the gateway's X-Gw-Audit-Trail — which means the token chain would stay empty
 * no matter how good the trail is. This route closes that gap: it calls the
 * gateway itself and hands the parsed `aam` section to the chain.
 *
 * Mounted behind authenticateToken like the other admin gateway routes.
 */

const express = require('express');
const axios = require('axios');
const configStore = require('../services/configStore');
const { parseGwAuditTrail } = require('../services/mcpGatewayClient');

const router = express.Router();

router.get('/probe', async (req, res) => {
  if (configStore.getEffective('ff_aam') !== 'true') {
    return res.status(200).json({ ok: false, disabled: true, reason: 'ff_aam is off' });
  }

  const base = process.env.MCP_PINGGATEWAY_URL || 'http://ping-gateway:8080';
  const simulated = configStore.getEffective('ff_authorize_simulated') === 'true';

  try {
    const gwRes = await axios.get(`${base}/aam/health`, {
      timeout: 20000,
      validateStatus: () => true,
      headers: {
        Host: 'api.ping.demo:3036',
        'X-Authz-Simulated': String(simulated),
        'X-BFF-Internal': process.env.BFF_INTERNAL_SECRET || '',
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
      },
    });

    const trail = parseGwAuditTrail(gwRes.headers['x-gw-audit-trail']);
    const aam = (trail && trail.aam) || null;

    return res.status(200).json({
      ok: true,
      httpStatus: gwRes.status,
      decision: aam ? aam.decision : null,
      backend: aam ? aam.backend : null,
      elapsedMs: aam ? aam.elapsedMs : null,
      request: aam ? aam.request : null,
      response: aam ? aam.response : null,
    });
  } catch (err) {
    return res.status(200).json({ ok: false, error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount it**

In `demo_api_server/server.js`, beside the other authenticated API mounts:

```javascript
app.use('/api/aam', authenticateToken, require('./routes/aamProbe'));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/aamProbe.test.js --forceExit`
Expected: PASS, 3 tests.

- [ ] **Step 6: Restore test-regenerated data, then commit**

```bash
git status --porcelain demo_api_server/data | head
git checkout -- demo_api_server/data 2>/dev/null || true
git add demo_api_server/routes/aamProbe.js demo_api_server/tests/aamProbe.test.js \
        demo_api_server/services/mcpGatewayClient.js demo_api_server/server.js
git commit -m "feat(aam): parse the aam trail section and add GET /api/aam/probe"
```

---

## Task 4: `ff_aam` feature flag

**Files:**
- Modify: `demo_api_server/services/configStore.js` (three sites)
- Create: `demo_api_server/tests/ffAam.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `configStore.getEffective('ff_aam')` returning `'true'` by default; consumed by Task 3's probe route.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/ffAam.test.js`:

```javascript
'use strict';
const configStore = require('../services/configStore');

describe('ff_aam', () => {
  test('defaults to on', () => {
    expect(configStore.getEffective('ff_aam')).toBe('true');
  });

  test('is publicly readable, like the other demo flags', () => {
    const pub = configStore.getPublicFlags ? configStore.getPublicFlags() : null;
    if (pub) expect(Object.keys(pub)).toContain('ff_aam');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/ffAam.test.js --forceExit`
Expected: FAIL — `ff_aam` is undefined, not `'true'`.

- [ ] **Step 3: Register the flag at all three sites**

In `demo_api_server/services/configStore.js`, mirroring `ff_mcp_gateway_jwks`:

```javascript
// site 1 — registry with default (near line 355)
ff_aam:                          { public: true, default: 'true' },  // PingOne Authorize API Access Management on the IG /aam route

// site 2 — env alias map (near line 1144)
ff_aam:                          ['FF_AAM'],

// site 3 — env name map (near line 2148)
ff_aam:                     'FF_AAM',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/ffAam.test.js tests/aamProbe.test.js --forceExit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -- demo_api_server/data 2>/dev/null || true
git add demo_api_server/services/configStore.js demo_api_server/tests/ffAam.test.js
git commit -m "feat(aam): ff_aam feature flag, default on"
```

---

## Task 5: `gw-aam` token chain event

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.js`
- Create: `demo_api_ui/src/components/__tests__/TokenChainDisplay.aam.test.jsx`

**Interfaces:**
- Consumes: the probe payload from Task 3.
- Produces: a rendered `gw-aam` chain event.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TokenChainDisplay.aam.test.jsx`:

```jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import TokenChainDisplay from '../TokenChainDisplay';

describe('gw-aam chain event', () => {
  const event = {
    id: 'gw-aam',
    decision: 'DENY',
    backend: 'mock',
    elapsedMs: 12,
    request: { method: 'GET', url: 'http://api.ping.demo:3036/aam/health' },
    response: { response: { response_code: '403' } },
  };

  test('renders the API Access Management label', () => {
    render(<TokenChainDisplay events={[event]} />);
    expect(screen.getByText(/API Access Management/i)).toBeInTheDocument();
  });

  test('shows the decision', () => {
    render(<TokenChainDisplay events={[event]} />);
    expect(screen.getByText(/DENY/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDisplay.aam.test.jsx`
Expected: FAIL — no `API Access Management` text, because `gw-aam` is unknown.

- [ ] **Step 3: Add the event at all three sites**

In `demo_api_ui/src/components/TokenChainDisplay.js`, following the `gw-authorize` pattern:

1. Ordered event-id list (near line 2635) — add `"gw-aam"` immediately after `"gw-authorize"`.
2. Label map (near line 2817) — add `"gw-aam": "API Access Management",`.
3. A renderer beside the `gw-authorize` one (near line 2019), guarded the same way:

```jsx
function AamEventDetail({ event }) {
  if (event.id !== "gw-aam") return null;
  return (
    <div className="tcd-event-detail">
      <div className="tcd-row">
        <span className="tcd-key">Decision</span>
        <span className="tcd-val">{event.decision || "unknown"}</span>
      </div>
      <div className="tcd-row">
        <span className="tcd-key">Backend</span>
        <span className="tcd-val">{event.backend === "mock" ? "Mock Sideband" : "PingOne Authorize"}</span>
      </div>
      <div className="tcd-row">
        <span className="tcd-key">Sideband request</span>
        <pre className="tcd-json">{JSON.stringify(event.request, null, 2)}</pre>
      </div>
      <div className="tcd-row">
        <span className="tcd-key">Sideband response</span>
        <pre className="tcd-json">{JSON.stringify(event.response, null, 2)}</pre>
      </div>
    </div>
  );
}
```

Reuse whatever JSON viewer the `gw-authorize` renderer uses rather than `<pre>` if one is present — match the surrounding code.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDisplay.aam.test.jsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both exit 0. The build gate is required for any `demo_api_ui` change.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.js \
        demo_api_ui/src/components/__tests__/TokenChainDisplay.aam.test.jsx
git commit -m "feat(aam): render the gw-aam event in the token chain"
```

---

## Task 6: Documentation and cross-service verification

**Files:**
- Modify: `ping-gateway/README.md`
- Modify: `REGRESSION_PLAN.md` (§4 entry)

- [ ] **Step 1: Update the gateway README**

Extend the "API Access Management route" section with the simulated-mode switch (`X-Authz-Simulated` selects `AAM_MOCK_BASE`), the `ff_aam` flag, and the `GET /api/aam/probe` endpoint.

- [ ] **Step 2: Run the cross-service gate**

```bash
npm run topology:verify
cd demo_api_server && CI=true npm test -- --forceExit
cd ../demo_api_ui && npm run test:unit && npm run build
```

Expected: all exit 0. Paste the result lines into the PR body — assertion without evidence is not acceptable.

- [ ] **Step 3: Confirm the live stack is unharmed**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3036/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3036/mcp  # 401
```

- [ ] **Step 4: Log the work in REGRESSION_PLAN.md §4 and commit**

```bash
git add ping-gateway/README.md REGRESSION_PLAN.md
git commit -m "docs(aam): simulated mode, ff_aam, and the probe endpoint"
```

---

## Self-review

**Spec coverage.** Every spec section maps to a task: architecture and the capture/stamp filters → Task 1; audit trail → Tasks 1 and 3; the missing caller → Task 3; feature flag → Task 4; mock Sideband endpoint → Task 2; token chain rendering → Task 5; security (redaction at capture) → Task 1 Step 1; testing → each task's own steps plus Task 6. Phase 0 is Task 0, reduced to verification because it is already done.

**Placeholders.** Two intentional substitutions remain and are both marked inline: `<wt>` for the worktree name in the docker mount paths, and the `原` identifier in the capture filter, which is called out in the step immediately below the code block. No "TBD" or "handle errors appropriately" steps.

**Type consistency.** The `aam` trail keys — `decision`, `backend`, `serviceUri`, `elapsedMs`, `request`, `response` — are produced in Task 1 Step 1, asserted in Task 3 Step 1, returned by the route in Task 3 Step 3, and consumed in Task 5 Step 1.

**Ordering defect found and fixed.** Task 3's probe route reads `ff_aam`, which Task 4 registers. Taken in numeric order the probe would answer `disabled` and Task 3's verification would pass for the wrong reason. Task 3 now carries an explicit "run Task 4 first" note in its Interfaces block. Execution order is therefore **0 → 1 → 2 → 4 → 3 → 5 → 6**.
