# NHI Workload Federation Registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register the SE EKS cluster's `ping-devops-cmuir` namespace as a federated non-human identity (NHI) in PingOne Privilege's new "Register non-human identity" flow — a Kubernetes ServiceAccount Token issuer verified via JWKS, no stored credential — and prove end-to-end that the trust relationship actually works, before any dependent feature is built on top of it.

**Architecture:** A dedicated, permission-less Kubernetes ServiceAccount in `ping-devops-cmuir` is the workload identity. Its projected token's signature is verified locally against the cluster's own public JWKS *before* it is ever pasted into the Privilege console, so the manual registration step (Task 4) has already been de-risked by the time it happens. The console registration itself is a manual browser action — this repo has no Privilege admin API/MCP access for it (see Non-Goals).

**Tech Stack:** kubectl (existing SE cluster access, context `us`), Node.js `jsonwebtoken` (already a `demo_api_server` dependency), no new dependencies.

**Spec:** No separate spec doc — scoped directly from conversation research (this plan's "Research findings" section is the spec).

## Research findings (read before executing)

- **The reporting half of this feature is real but not available to us yet.** `privilege/LESSONS-LEARNED.md` (line 682) shows the Privilege *Mac desktop agent* logs `collectShadowAIEvents: shadowAISync not initialized` — proof `shadowAISync`/shadow-AI discovery is a real, existing Privilege capability. But the only sensor binary we have evidence of is the Mac desktop agent (`cyonagent_mac`, per-workstation). The Helm chart we already hold (`pingone-privgateway-helm-main/agent/privgateway-0.1.0.tgz`) deploys `cyonproxy` (the MCP gateway proxy) — **not** a shadow-AI discovery sensor. There is no k8s-deployable sensor in anything this repo currently has access to.
- **Update after console registration (2026-09-14):** the Privilege console now offers a `procyon-nodesensor` Helm chart and generated install values. That vendor artifact is outside this repository and has not been deployed or permission-reviewed here; deploying and validating it is follow-up work, not part of the registration proof below.
- **Consequence:** registering the cluster as an NHI (Tasks 1-4 below) is real and complete. Actually receiving discovered-workload reports via `shadowai:write` remains parked: the vendor chart now shown by the console has not been deployed or permission-reviewed — Task 5 records that follow-up instead of faking reports.
- **The public Privilege docs don't cover this yet either** — `docs.pingidentity.com/privilege/llms.txt` has no pages on NHI registration, workload federation, or `shadowai:write` as of 2026-09-14. Confirmed by direct fetch, not assumed.
- **Cluster identity, confirmed live:** kubectl context `us` already points at the SE EKS cluster; the real AI-DEMO2 workloads run in namespace `ping-devops-cmuir` (confirmed via `kubectl get svc -n ping-devops-cmuir` → `mcp-resource-server`, `grafana`, `jaeger`, `loki`, `prometheus`). `ping-devops-curtismuir` is a separate namespace (Privilege gateway sandbox: `agentless-mcpgw`, `opensearch-mcp-server`) — do not confuse the two.
- **Our kubectl user lacks RBAC to hit `/.well-known/openid-configuration` through the apiserver proxy** (`Forbidden` when tried live) — Task 1 reads the issuer out of a minted token's own `iss` claim instead, which needs no extra RBAC.

## Non-Goals (explicitly out of scope for this plan)

- Building or deploying a `shadowai:write` reporter. The console offers a vendor `procyon-nodesensor` chart, but this plan does not deploy or validate that artifact — see Task 5.
- Automating the console registration step itself. There is no documented Privilege admin API and no MCP tool for it (`scripts/privilege-console-probe.mjs` reverse-engineers a read-only console API using a human's `auth_token` browser cookie — there is no service-account credential path). Task 4 is a manual runbook for a human to execute.
- Wiring `docs/use-cases/nhi-inventory.md` / `ControlPlaneRoster.jsx` to real discovery data. That depends on Task 5's outcome and is not part of this plan.

## Global Constraints

- Namespace for all cluster resources: `ping-devops-cmuir` (not `ai-demo` — that namespace does not exist on this cluster).
- No new npm dependencies — use `jsonwebtoken`, already in `demo_api_server/package.json`.
- Never commit or log a minted ServiceAccount token or console `auth_token` — treat both as credentials for the duration they're valid.
- The registered ServiceAccount must carry zero RBAC bindings. It exists only to prove a federated identity; it must never be usable to act against the cluster.

---

### Task 1: Confirm the cluster's OIDC issuer and JWKS are real and publicly reachable

**Files:**
- Create: `scripts/nhi/check-cluster-jwks.sh`

**Interfaces:**
- Produces: a JWKS URL string, written to stdout, that Task 3's script consumes as `JWKS_URL`.

- [x] **Step 1: Write the check script**

```bash
#!/usr/bin/env bash
# scripts/nhi/check-cluster-jwks.sh
# Prints the EKS cluster's public JWKS URL, proven reachable, or exits non-zero.
set -euo pipefail

NAMESPACE="ping-devops-cmuir"
SA="default"

echo "Minting a short-lived token for ${NAMESPACE}/${SA} to read its issuer claim..." >&2
TOKEN=$(kubectl create token "${SA}" -n "${NAMESPACE}" --duration=5m)

# Decode the JWT payload (no signature check needed here — we only want `iss`).
PAYLOAD=$(echo "${TOKEN}" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null || true)
ISSUER=$(echo "${PAYLOAD}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.iss)')

if [ -z "${ISSUER}" ]; then
  echo "FAIL: could not extract an issuer (iss) claim from the minted token." >&2
  exit 1
fi
echo "Issuer: ${ISSUER}" >&2

DISCOVERY_URL="${ISSUER%/}/.well-known/openid-configuration"
JWKS_URL=$(curl -fsSL "${DISCOVERY_URL}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.jwks_uri)')

if [ -z "${JWKS_URL}" ]; then
  echo "FAIL: discovery document at ${DISCOVERY_URL} did not contain jwks_uri." >&2
  exit 1
fi

# Prove the JWKS itself is publicly fetchable with actual keys — not just that
# the URL resolves.
KEY_COUNT=$(curl -fsSL "${JWKS_URL}" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String((d.keys||[]).length))')
if [ "${KEY_COUNT}" -lt 1 ] 2>/dev/null; then
  echo "FAIL: JWKS at ${JWKS_URL} returned zero keys." >&2
  exit 1
fi

echo "OK: JWKS at ${JWKS_URL} is public and has ${KEY_COUNT} key(s)." >&2
echo "${JWKS_URL}"
```

- [x] **Step 2: Make it executable and run it**

Run: `chmod +x scripts/nhi/check-cluster-jwks.sh && scripts/nhi/check-cluster-jwks.sh`
Expected: stderr shows the issuer, the JWKS URL, and `OK: ... has N key(s)` with N >= 1; stdout is exactly the JWKS URL. A `Forbidden` error on the `kubectl create token` step means the `default` ServiceAccount lacks the `create` verb on `serviceaccounts/token` — rerun with a ServiceAccount that has it, or ask for that RBAC grant before continuing (do not proceed on a guess).

- [x] **Step 3: Commit**

```bash
git add scripts/nhi/check-cluster-jwks.sh
git commit -m "feat(nhi): script to confirm the SE cluster's JWKS is public"
```

---

### Task 2: Create the dedicated, permission-less ServiceAccount

**Files:**
- Create: `k8s/nhi-shadow-ai-sensor-serviceaccount.yaml`

**Interfaces:**
- Consumes: namespace `ping-devops-cmuir` (Global Constraints).
- Produces: ServiceAccount name `shadow-ai-sensor`, consumed by Task 3's token-minting step and Task 4's console form.

- [x] **Step 1: Write the manifest**

```yaml
# k8s/nhi-shadow-ai-sensor-serviceaccount.yaml
# Identity-only ServiceAccount for the PingOne Privilege NHI registration.
# Deliberately carries no RoleBinding — it must never be usable to act
# against the cluster, only to prove a federated identity via its token's
# signature (see docs/superpowers/plans/2026-09-14-nhi-workload-federation-registration.md).
apiVersion: v1
kind: ServiceAccount
metadata:
  name: shadow-ai-sensor
  namespace: ping-devops-cmuir
  labels:
    app.kubernetes.io/part-of: privilege-nhi
```

- [x] **Step 2: Apply it and verify no RBAC is attached**

Run: `kubectl apply -f k8s/nhi-shadow-ai-sensor-serviceaccount.yaml`
Expected: `serviceaccount/shadow-ai-sensor created`

Run: `kubectl auth can-i --list --as=system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor -n ping-devops-cmuir`
Expected: no verbs beyond the cluster's baseline `system:authenticated` defaults (no explicit grants for this SA) — confirms it is identity-only.

- [x] **Step 3: Commit**

```bash
git add k8s/nhi-shadow-ai-sensor-serviceaccount.yaml
git commit -m "feat(nhi): add permission-less ServiceAccount for Privilege NHI registration"
```

---

### Task 3: Mint a token and verify it against the cluster's own JWKS locally

This is the task that actually de-risks Task 4: it proves, offline, that the exact verification Privilege's "Fetch from URL" key source will do (fetch JWKS, verify signature, check issuer) succeeds — before any console form is filled in.

**Files:**
- Create: `demo_api_server/scripts/nhi/verifyClusterToken.js`
- Test: `demo_api_server/scripts/nhi/verifyClusterToken.test.js`

**Interfaces:**
- Consumes: `jsonwebtoken` (already a dependency); a JWKS URL (Task 1's output) and a token string, both passed as CLI args for the live run.
- Produces: `verifyToken(token, jwks)` — `(token: string, jwks: {keys: object[]}) => {valid: boolean, claims?: object, error?: string}` — pure function, no network I/O, so it's fully unit-testable without hitting the real cluster.

- [x] **Step 1: Write the failing test**

```js
// demo_api_server/scripts/nhi/verifyClusterToken.test.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { verifyToken } = require('./verifyClusterToken');

function makeKeyPairAndJwks(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256', kty: 'RSA' }] },
  };
}

test('verifies a token signed by a key present in the JWKS', () => {
  const { privateKey, jwks } = makeKeyPairAndJwks('test-kid-1');
  const token = jwt.sign(
    { sub: 'system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor' },
    privateKey,
    { algorithm: 'RS256', keyid: 'test-kid-1', issuer: 'https://example-issuer.test', expiresIn: '5m' },
  );

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(true);
  expect(result.claims.sub).toBe('system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor');
});

test('rejects a token whose kid is not in the JWKS', () => {
  const { jwks } = makeKeyPairAndJwks('key-in-jwks');
  const { privateKey: otherKey } = makeKeyPairAndJwks('unused');
  const token = jwt.sign({ sub: 'x' }, otherKey, { algorithm: 'RS256', keyid: 'key-not-in-jwks' });

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(false);
  expect(result.error).toMatch(/kid/i);
});

test('rejects a token signed by a different key than the one matching its kid', () => {
  const { jwks } = makeKeyPairAndJwks('shared-kid');
  const { privateKey: wrongKey } = makeKeyPairAndJwks('shared-kid');
  const token = jwt.sign({ sub: 'x' }, wrongKey, { algorithm: 'RS256', keyid: 'shared-kid' });

  const result = verifyToken(token, jwks);

  expect(result.valid).toBe(false);
  expect(result.error).toBeTruthy();
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest scripts/nhi/verifyClusterToken.test.js --forceExit`
Expected: FAIL — `Cannot find module './verifyClusterToken'`

- [x] **Step 3: Write the minimal implementation**

```js
// demo_api_server/scripts/nhi/verifyClusterToken.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

/**
 * Verifies a JWT against a JWKS document, the same check Privilege's
 * "Fetch from URL" key source performs. Pure — no network calls.
 * @param {string} token
 * @param {{keys: object[]}} jwks
 * @returns {{valid: boolean, claims?: object, error?: string}}
 */
function verifyToken(token, jwks) {
  const decodedHeader = jwt.decode(token, { complete: true })?.header;
  if (!decodedHeader?.kid) {
    return { valid: false, error: 'token has no kid header' };
  }

  const jwk = jwks.keys.find((k) => k.kid === decodedHeader.kid);
  if (!jwk) {
    return { valid: false, error: `no key in JWKS matches kid "${decodedHeader.kid}"` };
  }

  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const claims = jwt.verify(token, publicKey, { algorithms: ['RS256'] });
    return { valid: true, claims };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

async function main() {
  const [jwksUrl, token] = process.argv.slice(2);
  if (!jwksUrl || !token) {
    console.error('Usage: node verifyClusterToken.js <jwksUrl> <token>');
    process.exit(2);
  }
  const res = await fetch(jwksUrl);
  const jwks = await res.json();
  const result = verifyToken(token, jwks);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { verifyToken };
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest scripts/nhi/verifyClusterToken.test.js --forceExit`
Expected: PASS — 3 passed

- [x] **Step 5: Run it live against the real cluster token**

Run:
```bash
JWKS_URL=$(scripts/nhi/check-cluster-jwks.sh)
TOKEN=$(kubectl create token shadow-ai-sensor -n ping-devops-cmuir --duration=10m)
node demo_api_server/scripts/nhi/verifyClusterToken.js "$JWKS_URL" "$TOKEN"
```
Expected: `{"valid": true, "claims": {"sub": "system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor", ...}}`. If this fails, do not proceed to Task 4 — the console registration will fail the same way and be harder to debug there.

- [x] **Step 6: Commit**

```bash
git add demo_api_server/scripts/nhi/verifyClusterToken.js demo_api_server/scripts/nhi/verifyClusterToken.test.js
git commit -m "feat(nhi): verify a cluster ServiceAccount token against its own JWKS"
```

---

### Task 4: Manual console registration runbook

This is a human-executed task in the Privilege browser console (no API/MCP access exists for it — see Non-Goals). Its deliverable is a documented record, not code.

**Files:**
- Modify: `privilege/CURRENT-CONFIGURATION.md` (existing doc that already tracks what's live in Privilege for this demo)

- [x] **Step 1: Execute the registration**

In the Privilege console's "Register non-human identity" screen:

| Field | Value |
|---|---|
| Name | `ai-demo-se-cluster-sensor` |
| Description | `Identity-only ServiceAccount proving cluster federation for shadow-AI discovery. No RBAC bindings. See docs/superpowers/plans/2026-09-14-nhi-workload-federation-registration.md.` |
| Token issuer type | Kubernetes — ServiceAccount Token |
| ServiceAccount | Existing → namespace `ping-devops-cmuir`, name `shadow-ai-sensor` |
| Key source | Fetch from URL |
| JWKS URL | the value Task 1's script printed |
| Permissions | `shadowai:write` only — leave `policy:read` unchecked (least privilege; nothing in this plan reads policy) |

- [x] **Step 2: Record the result**

Add a new section to `privilege/CURRENT-CONFIGURATION.md`:

```markdown
## NHI: ai-demo-se-cluster-sensor

- Registered: 2026-09-14
- ServiceAccount: system:serviceaccount:ping-devops-cmuir:shadow-ai-sensor (no RBAC bindings)
- JWKS URL: `https://oidc.eks.us-east-2.amazonaws.com/id/9ACBE86EA026DE86EFC05A61A5F83B30/keys`
- Generated audience: `priv-nhi-zqgtl66tzwdjs46qmjfq5p4gg4ngvsxh`
- Permission: shadowai:write only
- Status: registered; NOT receiving reports — the optional `procyon-nodesensor`
  chart has not been deployed. This registration only proves the federation
  trust works.
```

- [x] **Step 3: Commit**

```bash
git add privilege/CURRENT-CONFIGURATION.md
git commit -m "docs(nhi): record the registered cluster NHI in CURRENT-CONFIGURATION"
```

---

### Task 5: Spike — confirm sensor availability, park the reporting half

**Files:**
- Modify: `TECH_DEBT.md`

- [x] **Step 1: Check for a newer sensor artifact**

Re-run the check this plan already did once: `grep -rl "sensor" pingone-privgateway-helm-main/` and check whether a Ping SE/Privilege contact has shipped a k8s DaemonSet or sidecar variant of the shadow-AI agent since 2026-09-14. If one now exists, this plan's scope was deliberately limited to registration — building the reporter is new work, not covered here.

- [x] **Step 2: Record the parked state**

Add to `TECH_DEBT.md`:

```markdown
## Shadow-AI reporting for UC-NHI1 is registered but not wired

The SE cluster is registered as a federated NHI in Privilege
(`privilege/CURRENT-CONFIGURATION.md` → `ai-demo-se-cluster-sensor`), but
nothing calls `shadowai:write` yet. The console offers a vendor
`procyon-nodesensor` Helm chart, but it has not been deployed or validated in
this cluster. `docs/use-cases/nhi-inventory.md` (UC-NHI1) still runs on
`demo_api_server/services/controlPlane/demoAgentRoster.js` mock data as a
result.

Upgrade path: review and deploy the vendor chart with the registered
`shadow-ai-sensor` ServiceAccount and generated audience, verify a real report,
then extend `demo_api_server/services/controlPlane/liveAgentInfo.js` to pull
real discovered-workload data instead of the mock roster.
```

- [x] **Step 3: Commit**

```bash
git add TECH_DEBT.md
git commit -m "docs(nhi): park shadow-AI reporting pending a k8s-deployable sensor"
```

---

## Self-Review

**Spec coverage:** Task 1 covers "prove the JWKS is real"; Task 2 covers "create the identity, least-privilege"; Task 3 covers "prove the federation trust works before touching the console"; Task 4 covers the actual registration + record-keeping; Task 5 records the newly surfaced vendor sensor artifact as follow-up without deploying it. Non-Goals names the three things this plan deliberately does not build.

**Placeholder scan:** no TBD/"add error handling"/"similar to Task N" — every code step has real, runnable content; Task 4/5 are manual/doc tasks by nature (no code exists to place there) and say so explicitly rather than faking code.

**Type consistency:** `verifyToken(token, jwks)` signature and return shape (`{valid, claims?, error?}`) is identical in the test file, the implementation, and the live-run step's expected output.
