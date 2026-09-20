# Kubernetes Ping-Domain Access Lockdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict `ai-demo.ping-devops.com` to verified PingOne identities whose exact email domain is `pingidentity.com` or `pingone.com`, while recording every login attempt and terminal outcome in the existing persistent audit pipeline.

**Architecture:** A reusable BFF policy service validates identity claims and stamps a versioned approval into the server-side session. OAuth callbacks enforce it before persisting credentials, a global BFF middleware protects direct API access, and ingress-nginx external auth hides the SPA, APIs, Grafana, and static files until the BFF approves the session. Structured login events flow through `appEventService` to NDJSON, New Relic, and Loki.

**Tech Stack:** Node.js 22/CommonJS, Express 4, express-session, Jest/Supertest, Kubernetes ingress-nginx YAML, shell/Node static verification scripts.

**Spec:** `docs/superpowers/specs/2026-09-19-k8s-ping-domain-lockdown-design.md`

## Global Constraints

- Protect only `https://ai-demo.ping-devops.com`; do not change public MCP ingresses.
- The BFF remains the sole browser-token custodian.
- Preserve OAuth state, nonce, PKCE, issuer, signature, audience, expiry, callback-origin checks, session regeneration, and four-signal admin-role resolution.
- Exact verified domains are `pingidentity.com` and `pingone.com`; missing, malformed, Unicode-lookalike, or unverified identities fail closed.
- Never log tokens, authorization codes, cookies, PKCE verifiers, raw session IDs, or raw provider error text.
- The gate defaults off outside hosted Kubernetes.
- Do not add a hidden bypass header, query parameter, cookie, or hard-coded user.
- Deploy only to local Docker unless the user explicitly authorizes a remote deployment.

---

### Task 1: Hosted Access Policy and Session Approval

**Files:**
- Create: `demo_api_server/services/hostedAccessPolicy.js`
- Test: `demo_api_server/src/__tests__/hostedAccessPolicy.test.js`

**Interfaces:**
- Consumes: `HOSTED_ACCESS_GATE_ENABLED`, `HOSTED_ACCESS_ALLOWED_DOMAINS`, and `HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL` from an env-like object.
- Produces: `loadHostedAccessPolicy(env)`, `evaluateHostedIdentity(claims, policy)`, `stampHostedAccessApproval(session, decision, policy)`, `hasCurrentHostedAccessApproval(session, policy)`, and `clearHostedAccessApproval(session)`.

- [ ] **Step 1: Write failing policy tests**

Cover disabled defaults, enabled-with-empty-domain rejection, normalization, exact-domain acceptance, suffix/subdomain/lookalike rejection, malformed email rejection, `email_verified !== true`, policy fingerprint stability, approval stamping, user-subject mismatch, and policy-change invalidation.

```js
expect(evaluateHostedIdentity(
  { sub: 'user-1', email: 'Person@PingIdentity.com', email_verified: true },
  policy,
)).toMatchObject({ allowed: true, domain: 'pingidentity.com' });

expect(evaluateHostedIdentity(
  { sub: 'user-2', email: 'person@pingidentity.com.example.org', email_verified: true },
  policy,
)).toMatchObject({ allowed: false, reason: 'domain_not_allowed' });
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessPolicy.test.js --forceExit`

Expected: FAIL because `services/hostedAccessPolicy.js` does not exist.

- [ ] **Step 3: Implement the minimal policy service**

Use `crypto.createHash('sha256')` over canonical JSON for the policy fingerprint. Parse one email using an ASCII-only local/domain expression, reject trailing dots/empty labels/non-ASCII, lowercase only the domain, and use `Set.has(domain)`. Store this session shape:

```js
session.hostedAccessApproval = {
  version: 1,
  subject: decision.subject,
  email: decision.email,
  domain: decision.domain,
  approvedAt: Date.now(),
  policyFingerprint: policy.fingerprint,
};
```

`hasCurrentHostedAccessApproval` must require the current `session.user.oauthId || session.user.sub` to equal the stamped subject.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessPolicy.test.js --forceExit`

Expected: PASS.

- [ ] **Step 5: Commit the policy unit**

```bash
git add demo_api_server/services/hostedAccessPolicy.js demo_api_server/src/__tests__/hostedAccessPolicy.test.js
git commit -m "feat(auth): add hosted identity access policy"
```

### Task 2: Structured Login Audit Trail

**Files:**
- Create: `demo_api_server/services/authAccessAuditService.js`
- Test: `demo_api_server/src/__tests__/authAccessAuditService.test.js`

**Interfaces:**
- Consumes: Express request metadata and `appEventService.logEvent`.
- Produces: `startLoginAudit(req, loginType)`, `finishLoginAudit(req, { outcome, reasonCode, identity })`, `hashSessionId(sessionId)`, and exported closed sets `OUTCOMES`/`REASON_CODES`.

- [ ] **Step 1: Write failing audit tests**

Assert attempt and terminal event shapes, customer/admin login types, stable 16-character session hash, source-IP normalization, elapsed duration, terminal deduplication, closed reason codes, Loki-compatible metadata, and recursive absence of keys/values containing tokens, codes, cookies, secrets, or PKCE material.

```js
expect(logEvent).toHaveBeenCalledWith(
  'auth_lifecycle',
  'info',
  'Hosted login succeeded',
  expect.objectContaining({
    tag: 'hosted-access/login/success',
    metadata: expect.objectContaining({ eventType: 'hosted_login', outcome: 'success' }),
  }),
);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/authAccessAuditService.test.js --forceExit`

Expected: FAIL because the audit service does not exist.

- [ ] **Step 3: Implement the audit helper**

Persist only this closed metadata shape: event type, phase, outcome, reason code, login type, subject, normalized email/domain, source IP, truncated user agent, correlation ID, session hash, and duration. Store only the start timestamp/trace ID/login type in `req.session.hostedLoginAudit`; never copy query/body data. Severity is `info` for attempt/success, `warning` for denied, and `error` for failure.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/authAccessAuditService.test.js --forceExit`

Expected: PASS.

- [ ] **Step 5: Commit the audit unit**

```bash
git add demo_api_server/services/authAccessAuditService.js demo_api_server/src/__tests__/authAccessAuditService.test.js
git commit -m "feat(auth): audit hosted login outcomes"
```

### Task 3: Hosted Access Endpoint and Direct-BFF Middleware

**Files:**
- Create: `demo_api_server/middleware/hostedAccessGate.js`
- Create: `demo_api_server/routes/hostedAccess.js`
- Test: `demo_api_server/src/__tests__/hostedAccessGate.test.js`
- Modify: `demo_api_server/server.js`

**Interfaces:**
- Consumes: Task 1 policy/session helpers.
- Produces: `hostedAccessGate`, exact bypass predicate `isHostedAccessBypassPath(path, method)`, minimal `sendAccessRestricted(res)`, and `GET /api/auth/hosted-access/check` with `204`, `401`, or `403`.

- [ ] **Step 1: Write failing middleware and route tests**

Test disabled no-op, approved access, anonymous `401`, stale/ineligible `403`, no response details, exact customer/admin login and callback bypasses, `/api/healthz` probe bypass, signed webhook preservation, and rejection of prefix-confusion paths such as `/api/auth/oauth/user/callback/extra`.

```js
expect(isHostedAccessBypassPath('/api/auth/oauth/user/callback', 'GET')).toBe(true);
expect(isHostedAccessBypassPath('/api/auth/oauth/user/callback/extra', 'GET')).toBe(false);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js --forceExit`

Expected: FAIL because the middleware/routes do not exist.

- [ ] **Step 3: Implement endpoint, middleware, and server ordering**

Mount the check router immediately after `restoreSessionFromCookie`, then mount the global `/api` gate before other API routers. Keep webhooks at their current earlier mounts. Permit health probes at the BFF but rely on ingress auth to keep them unavailable through the hosted application hostname.

Return a fixed high-contrast HTML 403 response with `Cache-Control: no-store`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, and no policy/domain details.

- [ ] **Step 4: Run focused tests and server-load smoke**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessGate.test.js --forceExit`

Run: `cd demo_api_server && node -e "process.env.HOSTED_ACCESS_GATE_ENABLED='false'; require('./server'); setTimeout(() => process.exit(0), 500)"`

Expected: tests PASS and server loads without route-order errors.

- [ ] **Step 5: Commit the enforcement unit**

```bash
git add demo_api_server/middleware/hostedAccessGate.js demo_api_server/routes/hostedAccess.js demo_api_server/src/__tests__/hostedAccessGate.test.js demo_api_server/server.js
git commit -m "feat(auth): enforce hosted access on BFF routes"
```

### Task 4: Enforce and Audit Customer and Admin OAuth Login

**Files:**
- Modify: `demo_api_server/routes/oauthUser.js`
- Modify: `demo_api_server/routes/oauth.js`
- Test: `demo_api_server/src/__tests__/oauthUser.hostedAccess.test.js`
- Test: `demo_api_server/src/__tests__/oauth.hostedAccess.test.js`

**Interfaces:**
- Consumes: Tasks 1–3 policy, session, denial-response, and audit helpers.
- Produces: approved regenerated sessions for both OAuth client types and terminal audit outcomes for every callback exit.

- [ ] **Step 1: Write failing customer OAuth tests**

Mock the PingOne exchange/userinfo boundaries. Assert attempt logging at `/login`; exact-domain success stamps approval only after regeneration; domain/unverified denial occurs before datastore writes; provider/state/code/nonce/token/session failures emit one terminal event; denial destroys partial state and clears auth cookies.

- [ ] **Step 2: Write failing admin OAuth tests**

Mirror the customer assertions for admin login while asserting the existing four-signal role decision remains unchanged after eligibility passes.

- [ ] **Step 3: Run both focused suites and confirm RED**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js --forceExit`

Expected: FAIL because callbacks do not evaluate/stamp hosted access or emit the new terminal audit contract.

- [ ] **Step 4: Add minimal integrations to both login routes**

At login initiation call `startLoginAudit(req, 'user'|'admin')` before saving/redirecting. At callback, evaluate merged verified identity claims before datastore mutation. Pre-capture the decision across `session.regenerate`, stamp the new session, and call terminal success only inside the successful `session.save` callback. Route every existing callback failure through a small local helper that records one closed reason code before preserving the current response behavior.

- [ ] **Step 5: Run focused OAuth and protected regression tests**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js tests/oauthUser.test.js tests/oauthUserCallbackNonce.test.js src/__tests__/oauth-callback.test.js src/__tests__/oauth-login-resilience.test.js --forceExit`

Expected: PASS.

- [ ] **Step 6: Commit OAuth integration**

```bash
git add demo_api_server/routes/oauthUser.js demo_api_server/routes/oauth.js demo_api_server/src/__tests__/oauthUser.hostedAccess.test.js demo_api_server/src/__tests__/oauth.hostedAccess.test.js
git commit -m "feat(auth): restrict PingOne logins to approved domains"
```

### Task 5: Kubernetes Configuration and Protected Ingress

**Files:**
- Modify: `k8s/02-configmap.yaml`
- Modify: `k8s/aws/se-ingress.yaml`
- Create: `scripts/check-hosted-access-ingress.js`
- Modify: `package.json`
- Test: `scripts/check-hosted-access-ingress.test.js`

**Interfaces:**
- Consumes: `GET /api/auth/hosted-access/check` from Task 3.
- Produces: `npm run hosted-access:verify` and protected/bypass ingress resources for `ai-demo.ping-devops.com` only.

- [ ] **Step 1: Write the failing static manifest verifier tests**

Fixtures must prove rejection of missing auth annotations, a wildcard/prefix bypass, changed MCP ingress, missing gate config, or any domain other than the two approved exact values.

- [ ] **Step 2: Run verifier tests and confirm RED**

Run: `node --test scripts/check-hosted-access-ingress.test.js`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Add SE configuration and split ingress annotation scopes**

Set:

```yaml
HOSTED_ACCESS_GATE_ENABLED: "true"
HOSTED_ACCESS_ALLOWED_DOMAINS: "pingidentity.com,pingone.com"
HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL: "true"
```

Add external-auth annotations to the application/Grafana ingress. Use an internal ClusterIP auth URL containing the substituted namespace and an HTTPS sign-in URL on `ai-demo.ping-devops.com`. Add a separate bypass Ingress with only exact GET login/callback paths for both user and admin flows. Do not modify the MCP ingress document.

- [ ] **Step 4: Implement and run the static verifier**

The verifier parses documents structurally, asserts the protected host and annotations, compares the MCP document to its expected host/backends, enforces `Exact` bypass paths, and rejects additional bypass entries.

Run: `node --test scripts/check-hosted-access-ingress.test.js`

Run: `npm run hosted-access:verify`

Expected: PASS.

- [ ] **Step 5: Run existing nginx/topology guards**

Run: `npm run topology:verify`

Run: `npm run hygiene:check`

Expected: PASS and Code Explorer SSE annotations remain present.

- [ ] **Step 6: Commit Kubernetes enforcement**

```bash
git add k8s/02-configmap.yaml k8s/aws/se-ingress.yaml scripts/check-hosted-access-ingress.js scripts/check-hosted-access-ingress.test.js package.json
git commit -m "feat(k8s): protect hosted demo with PingOne session auth"
```

### Task 6: Deployment Documentation, Regression Record, and Smoke Contract

**Files:**
- Modify: `k8s/README.md`
- Modify: `k8s/smoke.sh`
- Modify: `REGRESSION_PLAN.md`

**Interfaces:**
- Consumes: policy configuration, audit schema, and ingress behavior from Tasks 1–5.
- Produces: operator claim-mapping/rollout/rollback instructions and optional authenticated smoke inputs.

- [ ] **Step 1: Add smoke assertions without embedding credentials**

Anonymous hosted smoke must expect a redirect to the user login route instead of SPA `200`. When `HOSTED_SMOKE_COOKIE` is provided, assert approved deep-link/API/Grafana access. Keep ineligible-user testing documented as a manual/non-production PingOne test account because credentials must not enter the repository.

- [ ] **Step 2: Document PingOne and operational setup**

Document both OAuth apps' `openid profile email`, `email`, and `email_verified` mappings; Loki query `{service="ai-demo-bff", category="auth_lifecycle"} | json | eventType="hosted_login"`; reason codes; audit-only observation; enforcement order; and rollback order. Explicitly state public MCP hosts are unchanged.

- [ ] **Step 3: Add the regression-plan entry**

Record files, threat addressed, exact invariants, no-secret audit contract, ingress/BFF defense in depth, MCP exclusion, and verification commands.

- [ ] **Step 4: Validate shell and documentation checks**

Run: `bash -n k8s/smoke.sh`

Run: `npm run hosted-access:verify`

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit operations documentation**

```bash
git add k8s/README.md k8s/smoke.sh REGRESSION_PLAN.md
git commit -m "docs(k8s): document hosted access rollout and audits"
```

### Task 7: Full Verification and Local Docker Validation

**Files:**
- Modify only if a failing check exposes a defect directly caused by Tasks 1–6.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: fresh completion evidence and a locally served worktree; no remote Kubernetes mutation.

- [ ] **Step 1: Install service dependencies in the worktree**

Run: `cd demo_api_server && npm ci`

Run root `npm ci` only if root verification reports missing dependencies.

- [ ] **Step 2: Run all new focused tests**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/hostedAccessPolicy.test.js src/__tests__/authAccessAuditService.test.js src/__tests__/hostedAccessGate.test.js src/__tests__/oauthUser.hostedAccess.test.js src/__tests__/oauth.hostedAccess.test.js --forceExit`

Run: `node --test scripts/check-hosted-access-ingress.test.js`

Expected: all PASS.

- [ ] **Step 3: Run repository auth and topology verification**

Run: `npm run authz:verify`

Run: `npm run topology:verify`

Run: `npm run hygiene:check`

Run: `npm run hosted-access:verify`

Expected: all PASS.

- [ ] **Step 4: Run the fast cross-service unit gate**

Run: `./run-tests.sh unit`

Expected: PASS. Investigate only failures connected to the touched surfaces; report unrelated baseline failures explicitly.

- [ ] **Step 5: Update repository graph and inspect the final diff**

Run: `graphify update .`

Run: `git diff --check`

Run: `git status --short`

Expected: no formatting errors and only intended generated graph changes, if any.

- [ ] **Step 6: Serve through local Docker only**

Run from the worktree root: `npm run serve:worktree here`

Verify the gate remains disabled locally unless explicitly enabled for the test. Check API health and UI `200` at `https://local.ping-devops.com:4000`. For an enforcement probe, restart only the BFF/UI with temporary local hosted-access env overrides through the repository-supported local configuration path; do not apply Kubernetes manifests and do not contact the remote cluster.

- [ ] **Step 7: Final implementation commit**

If verification exposes a directly related defect, stage the exact file named by
the failing test together with that test, inspect `git diff --cached`, and commit:

```bash
git commit -m "test(auth): verify hosted access lockdown"
```

Skip this commit when verification required no source changes; never stage
unrelated or generated files merely to create a final commit.

### Task 8: Branch Integration

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: verified feature branch.
- Produces: pushed branch and reviewable PR; merge only after required checks pass.

- [ ] **Step 1: Confirm clean status and commit list**

Run: `git status --short --branch`

Run: `git log --oneline origin/main..HEAD`

Expected: clean worktree and only feature commits.

- [ ] **Step 2: Push and open the PR**

Create `/tmp/k8s-ping-domain-lockdown-pr.md` containing the verified summary,
test commands/results, rollout ordering, and the explicit statement that no
remote Kubernetes deployment was performed. Then run:

```bash
git push -u origin feat/k8s-ping-domain-lockdown
gh pr create --base main --head feat/k8s-ping-domain-lockdown --title "feat: restrict hosted demo to Ping identities" --body-file /tmp/k8s-ping-domain-lockdown-pr.md
```

- [ ] **Step 3: Verify checks and merge**

Run: `gh pr checks --watch`

After required checks pass, merge using the repository's normal merge method. Do not deploy to the remote Kubernetes cluster.
