# PingOne Privilege MCPGW Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the PingOne Privilege MCPGW container in front of `mcp-server`, locally on `local.ping-devops.com:8623` and on the SE cluster at `https://ai-demo.ping-devops.com/mcpgw`, so the existing `/privilege-mcp-client` page can demonstrate JIT least-privilege denial plus session recording.

**Architecture:** A profile-gated Compose service and a k8s Deployment front the unchanged `mcp-server`. Locally the container carries a compose network alias of `local.ping-devops.com` so the browser (via `/etc/hosts`) and the BFF (via compose DNS) reach it by one cert-valid URL. On AWS a second Ingress object on the existing host strips a `/mcpgw` prefix. No UI files change — the client page's default comes from a BFF env var.

**Tech Stack:** Docker Compose, Kubernetes + nginx ingress, Node 22 CommonJS BFF (Express), Jest 29 + supertest.

Design spec: [`docs/superpowers/specs/2026-07-29-ping-mcpgw-design.md`](../specs/2026-07-29-ping-mcpgw-design.md)

## Global Constraints

- Work on a git worktree branch. The main checkout hard-blocks `Write`/`Edit`.
- Stage explicitly with `git add <files>`. Never `git add -A` — the BFF jest suite regenerates hundreds of files under `demo_api_server/data/`.
- BFF tests require `CI=true`. Without it supertest suites flake and a green run proves nothing.
- BFF error responses use `{ error }`, never `{ message }`.
- BFF is CommonJS (`require`), Node >= 22.
- Emoji allowlist (REGRESSION_PLAN §0): `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Nothing else.
- `MCPGW_IMAGE` has no default anywhere. An unset value must fail loudly.
- Never commit `ping-mcpgw/config/pingone.env`, root `.env`, or anything under `certs/`. All three are already gitignored and `.husky/pre-commit` blocks them.
- Do not rotate any PingOne secret. Use existing provisioned values as-is.

## Correction to the spec, applied in this plan

Spec §5 says the OIDC values reach the container via Compose `env_file:`. The vendor's own `pingone.env.example` header says otherwise:

> This file is mounted into the container at `/var/lib/procyon/config/pingone.env`.

So it is a **file mount**, not env-var injection. Task 2 mounts `ping-mcpgw/config` as a directory to that path. The spec's "env_file only, never environment" warning still stands as a general rule for this repo, but does not apply to this service. Task 6 updates the spec text.

## File Structure

| file | responsibility |
|---|---|
| `demo_api_server/routes/privilegeMcpClient.js` | one-line default for `config.mcpUrl` |
| `demo_api_server/tests/routes/privilegeMcpClient.state.test.js` | proves that default both ways |
| `docker-compose.yml` | `ping-mcpgw` service + `PRIVILEGE_MCPGW_URL` on the BFF |
| `run-docker.sh` | registers `mcpgw` as an optional group (4 edits) |
| `k8s/75-ping-mcpgw-deployment.yaml` | Deployment + ClusterIP Service |
| `k8s/deploy.sh` | applies the manifest |
| `k8s/create-secrets.sh` | builds `ping-mcpgw-secrets` from the gitignored env file |
| `k8s/aws/se-ingress.yaml` | removes the dead `/mcp` rule; adds a scoped second Ingress |
| `ping-mcpgw/README.md`, `ping-mcpgw/config/pingone.env.example` | corrected operator docs |
| `CHANGELOG.md` | entry |

---

### Task 1: BFF seeds the client page's MCP URL

The `/privilege-mcp-client` page reads its config from the BFF. Seeding the default server-side is what lets us change zero UI files.

**Files:**
- Modify: `demo_api_server/routes/privilegeMcpClient.js:19`
- Test: `demo_api_server/tests/routes/privilegeMcpClient.state.test.js` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: env var `PRIVILEGE_MCPGW_URL` (string, absolute URL to MCPGW's MCP endpoint). Task 2 sets it in Compose; Task 3 sets it in k8s. `GET /api/privilege-mcp/state` returns `{ config: { mcpUrl, ... }, oauth, tools }`.

Why this test works: `server.js:470` applies `express-session` globally, and supertest sends no cookie, so every request gets a fresh `sessionID`. `getClientSession()` therefore builds a new config object per request, reading `process.env` at that moment. Both branches are testable in one file with no module cache tricks.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/routes/privilegeMcpClient.state.test.js`:

```js
const request = require('supertest');
const app = require('../../server');

describe('GET /api/privilege-mcp/state — mcpUrl default', () => {
  const original = process.env.PRIVILEGE_MCPGW_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.PRIVILEGE_MCPGW_URL;
    else process.env.PRIVILEGE_MCPGW_URL = original;
  });

  it('seeds config.mcpUrl from PRIVILEGE_MCPGW_URL when set', async () => {
    process.env.PRIVILEGE_MCPGW_URL = 'https://local.ping-devops.com:8623/mcp';

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe('https://local.ping-devops.com:8623/mcp');
  });

  it('leaves config.mcpUrl empty when PRIVILEGE_MCPGW_URL is unset', async () => {
    delete process.env.PRIVILEGE_MCPGW_URL;

    const res = await request(app).get('/api/privilege-mcp/state').expect(200);

    expect(res.body.config.mcpUrl).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.state.test.js --forceExit
```

Expected: the first test FAILS with `Expected: "https://local.ping-devops.com:8623/mcp"` / `Received: ""`. The second test passes already — that is correct, it is the regression guard.

- [ ] **Step 3: Make the change**

In `demo_api_server/routes/privilegeMcpClient.js`, line 19, inside the `config` object literal:

```js
        mcpUrl: process.env.PRIVILEGE_MCPGW_URL || '',
```

replacing:

```js
        mcpUrl: '',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/routes/privilegeMcpClient.state.test.js --forceExit
```

Expected: 2 passed.

- [ ] **Step 5: Run the wider unit suite for regressions**

```bash
cd demo_api_server && CI=true npm run test:unit
```

Expected: same pass/fail set as before the change. Paste the summary line.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/privilegeMcpClient.js \
        demo_api_server/tests/routes/privilegeMcpClient.state.test.js
git commit -m "feat(privilege-mcp): seed client mcpUrl default from PRIVILEGE_MCPGW_URL"
```

---

### Task 2: Compose service and run-docker.sh wiring

**Files:**
- Modify: `docker-compose.yml` (add service near `ping-gateway` at ~line 970; add env var to `demo-api-server`)
- Modify: `run-docker.sh:76`, `:83`, `:86-96`, `:109-115`, `:128+`

**Interfaces:**
- Consumes: `PRIVILEGE_MCPGW_URL` from Task 1.
- Produces: compose service `ping-mcpgw`, container `ai-demo-ping-mcpgw`, profile `mcpgw`, optional group `mcpgw`. Task 3 mirrors the env values into k8s.

- [ ] **Step 1: Add the service to `docker-compose.yml`**

Insert after the `ping-gateway` service block (before `weaviate` at ~line 1092), matching the two-space service indentation used throughout:

```yaml
  # ── PingOne Privilege MCPGW (commercial) ───────────────────────────────────
  # Inline MCP security gateway: just-in-time least-privilege plus full session
  # recording. Policy is authored in the PingOne Privilege console, NOT in this
  # repo — the deliberate contrast with ping-gateway above, whose policy lives
  # in ping-gateway/config/routes/.
  #
  # MCPGW_IMAGE comes from the Privilege console gateway wizard
  # (Privilege > Cloud > Gateways > Add New > Add via Wizard). No default on
  # purpose: an unset value must fail the compose run, not pull something wrong.
  ping-mcpgw:
    profiles: ["mcpgw"]
    image: ${MCPGW_IMAGE:?set MCPGW_IMAGE from the PingOne Privilege gateway wizard}
    container_name: ai-demo-ping-mcpgw
    ports:
      - "8623:8623"
    volumes:
      # Vendor doc: pingone.env is READ AS A FILE at this path, not injected as
      # env vars. Directory mount (not per-file) — per-file bind mounts are
      # mis-detected when the host file is replaced, same lesson as the
      # ping-gateway config mount above.
      - ./ping-mcpgw/config:/var/lib/procyon/config:ro
      # Reuse the existing mkcert pair rather than duplicating a private key.
      # Per-file here because the vendor expects these exact filenames; the
      # certs are stable until Oct 2028 so the replace-hazard does not apply.
      - ./certs/api.ping.demo+2.pem:/var/lib/procyon/ssl/mcpgw-cert.pem:ro
      - ./certs/api.ping.demo+2-key.pem:/var/lib/procyon/ssl/mcpgw-key.pem:ro
    networks:
      ai-demo:
        # Cert-valid alias. certs/api.ping.demo+2.pem covers
        # local.ping-devops.com, so the BFF's server-side fetch verifies TLS
        # normally, while the browser reaches the same URL via /etc/hosts and
        # the published port. One URL string, correct for both callers.
        aliases:
          - local.ping-devops.com
    extra_hosts:
      - "host.docker.internal:host-gateway"
    restart: unless-stopped
```

- [ ] **Step 2: Add the BFF env var**

In the `demo-api-server` service's `environment:` block in `docker-compose.yml`, add:

```yaml
      # Default MCP endpoint offered by the /privilege-mcp-client page.
      PRIVILEGE_MCPGW_URL: "https://local.ping-devops.com:8623/mcp"
```

- [ ] **Step 3: Register the optional group in `run-docker.sh`**

Four edits.

`run-docker.sh:76`:
```bash
OPTIONAL_GROUP_NAMES=(rag agents tracing demo-auth mcpgw)
```

`run-docker.sh:83`:
```bash
FULL_STACK_PROFILE_ARGS=(--profile rag --profile agents --profile tracing --profile demo-auth --profile mcpgw)
```

In `_optional_group_profiles()`, add a case before `all)` and extend `all)`:
```bash
    mcpgw)     echo "mcpgw" ;;
    all)       echo "rag agents tracing demo-auth mcpgw" ;;
```

In `_optional_group_services()`, add a case before `all)` (the `all)` branch iterates `OPTIONAL_GROUP_NAMES` itself, so it needs no edit):
```bash
    mcpgw)     echo "ping-mcpgw" ;;
```

In `_optional_group_desc()`, add:
```bash
    mcpgw)     echo "PingOne Privilege MCPGW (JIT least-privilege + session recording)" ;;
```

- [ ] **Step 4: Verify the compose file parses and fails correctly without the image**

```bash
env -u MCPGW_IMAGE docker compose --profile mcpgw config >/dev/null
```

Expected: non-zero exit, with `set MCPGW_IMAGE from the PingOne Privilege gateway wizard` in stderr.

- [ ] **Step 5: Verify it resolves with the image set**

```bash
MCPGW_IMAGE=placeholder/mcpgw:test docker compose --profile mcpgw config | grep -A3 'ping-mcpgw:'
```

Expected: exit 0, and the rendered service shows `image: placeholder/mcpgw:test`.

- [ ] **Step 6: Verify the default stack is unaffected**

```bash
docker compose config --services | grep -c ping-mcpgw
```

Expected: `0` — the service is profile-gated and must not appear in the default service list.

- [ ] **Step 7: Verify the run-docker.sh group resolves**

```bash
bash -c 'source ./run-docker.sh 2>/dev/null; _optional_group_services mcpgw' 2>/dev/null || \
  grep -n 'mcpgw' run-docker.sh
```

Expected: `ping-mcpgw` printed, or (if sourcing is not safe) the grep shows all five `mcpgw` lines added above.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml run-docker.sh
git commit -m "feat(ping-mcpgw): add profile-gated compose service and optional group"
```

---

### Task 3: Kubernetes Deployment, Service, and secret

Mirrors `k8s/74-demo-mcpgw-deployment.yaml`, which is the direct analogue for namespace, labels, probes, and session affinity.

**Files:**
- Create: `k8s/75-ping-mcpgw-deployment.yaml`
- Modify: `k8s/deploy.sh` (apply list, after the `71-ping-gateway` line)
- Modify: `k8s/create-secrets.sh` (per-service secrets block, ~line 338)

**Interfaces:**
- Consumes: `PRIVILEGE_MCPGW_URL` semantics from Task 1; the `mcpgw` naming from Task 2.
- Produces: k8s Service `ping-mcpgw` on port 8623 in namespace `ai-demo`, consumed by Task 4's Ingress backend.

`sessionAffinity: ClientIP` is copied deliberately: MCP sessions are stateful via `Mcp-Session-Id`, so each client must pin to one pod.

- [ ] **Step 1: Create the manifest**

Create `k8s/75-ping-mcpgw-deployment.yaml`:

```yaml
---
# ping-mcpgw: PingOne Privilege MCPGW (commercial) fronting mcp-server.
# Policy and session recording are configured in the PingOne Privilege console,
# not in this repo. OIDC values come from ping-mcpgw/config/pingone.env via the
# ping-mcpgw-secrets secret (created by create-secrets.sh).
# Exposed externally at https://ai-demo.ping-devops.com/mcpgw via se-ingress.yaml.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ping-mcpgw
  namespace: ai-demo
  labels:
    app: ai-demo
    component: ping-mcpgw
spec:
  replicas: 1
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 0
      maxUnavailable: 1
  selector:
    matchLabels:
      app: ai-demo
      component: ping-mcpgw
  template:
    metadata:
      labels:
        app: ai-demo
        component: ping-mcpgw
    spec:
      containers:
      - name: ping-mcpgw
        # Replace with the image URI from the Privilege gateway wizard.
        image: MCPGW_IMAGE_PLACEHOLDER
        imagePullPolicy: Always
        ports:
        - containerPort: 8623
          name: https
        volumeMounts:
        # The vendor reads pingone.env as a FILE at this path — not as injected
        # env vars. This mirrors the Compose bind mount in Task 2. SERVER_URL
        # lives inside that file and differs per environment (see spec §5);
        # the MCP backend URL is set on the console's MCP Server tile, not here.
        - name: pingone-config
          mountPath: /var/lib/procyon/config
          readOnly: true
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        startupProbe:
          tcpSocket:
            port: 8623
          failureThreshold: 30
          periodSeconds: 2
          timeoutSeconds: 2
        livenessProbe:
          tcpSocket:
            port: 8623
          periodSeconds: 60
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          tcpSocket:
            port: 8623
          initialDelaySeconds: 5
          periodSeconds: 30
          timeoutSeconds: 3
          failureThreshold: 3
      volumes:
      - name: pingone-config
        secret:
          secretName: ping-mcpgw-secrets
          items:
          - key: pingone.env
            path: pingone.env
      restartPolicy: Always
---
apiVersion: v1
kind: Service
metadata:
  name: ping-mcpgw
  namespace: ai-demo
  labels:
    app: ai-demo
    component: ping-mcpgw
spec:
  type: ClusterIP
  ports:
  - port: 8623
    targetPort: 8623
    protocol: TCP
    name: https
  # MCP sessions are stateful (Mcp-Session-Id). Pin each client to the same
  # pod for the session lifetime.
  sessionAffinity: ClientIP
  sessionAffinityConfig:
    clientIP:
      timeoutSeconds: 3600
  selector:
    app: ai-demo
    component: ping-mcpgw
```

`MCPGW_IMAGE_PLACEHOLDER` is the one intentional placeholder in this plan. It is the wizard-supplied value and cannot be known until the console step runs. Step 4 asserts it is still present so nobody deploys it by accident.

- [ ] **Step 2: Add the apply line to `k8s/deploy.sh`**

Immediately after the existing `71-ping-gateway-deployment.yaml` line:

```bash
  kubectl apply -f "$SCRIPT_DIR/75-ping-mcpgw-deployment.yaml"   # PingOne Privilege MCPGW
```

- [ ] **Step 3: Add the secret to `k8s/create-secrets.sh`**

**Do not use `secret_from_envfile` here.** That helper turns each line into a separate `--from-literal` key, which produces env vars. MCPGW needs the file itself, so the secret must carry one key whose value is the whole file.

In the per-service secrets block, after the `ping-gateway-secrets` line:

```bash
# Privilege MCPGW: the vendor reads pingone.env as a FILE, so this secret holds
# the whole file under one key rather than one key per variable.
if [ -f "$ASSET_ROOT/ping-mcpgw/config/pingone.env" ]; then
  kubectl create secret generic ping-mcpgw-secrets \
    --namespace="$NS" \
    --from-file=pingone.env="$ASSET_ROOT/ping-mcpgw/config/pingone.env" \
    --dry-run=client -o yaml | kubectl apply -f -
  info "  ping-mcpgw-secrets applied (pingone.env from ping-mcpgw/config/)"
else
  warn "  ping-mcpgw/config/pingone.env not found — skipping secret ping-mcpgw-secrets"
fi
```

The guard mirrors `secret_from_envfile`'s own behaviour, so this stays safe on machines that have not done the console setup.

- [ ] **Step 4: Verify the manifest is valid and still un-deployable**

```bash
kubectl apply --dry-run=client -f k8s/75-ping-mcpgw-deployment.yaml
grep -c MCPGW_IMAGE_PLACEHOLDER k8s/75-ping-mcpgw-deployment.yaml
```

Expected: the dry-run reports `deployment.apps/ping-mcpgw created (dry run)` and `service/ping-mcpgw created (dry run)`; the grep prints `1`.

If no cluster is reachable, use `kubectl apply --dry-run=client --validate=false -f ...`, which still parses the YAML.

- [ ] **Step 5: Commit**

```bash
git add k8s/75-ping-mcpgw-deployment.yaml k8s/deploy.sh k8s/create-secrets.sh
git commit -m "feat(ping-mcpgw): add k8s deployment, service, and OIDC secret wiring"
```

---

### Task 4: Ingress — remove the dead rule, add a scoped second object

**Files:**
- Modify: `k8s/aws/se-ingress.yaml`

**Interfaces:**
- Consumes: Service `ping-mcpgw:8623` from Task 3.
- Produces: `https://ai-demo.ping-devops.com/mcpgw/...` reaching the container as `/...`.

The critical constraint: `rewrite-target` is an **Ingress-level** annotation. Putting it on `ai-demo-ingress` would rewrite the `/` frontend rule and take the whole app down. MCPGW therefore gets its own Ingress object. `k8s/aws/deploy.sh:220` pipes this file through `sed | kubectl apply -f -`, which handles multi-document YAML, so the second document inherits the `<<NAMESPACE>>` substitution.

- [ ] **Step 1: Delete the dead `/mcp` rule**

In `k8s/aws/se-ingress.yaml`, remove this block and its preceding comment (lines 26-34):

```yaml
      # demo-mcpgw (PingGateway MCPGW image) must come before the / catch-all
      # so nginx selects the longer prefix match. The IG route strips /mcp
      # internally via UriPathRewriteFilter before proxying to mcp-server:8080.
      - path: /mcp
        pathType: Prefix
        backend:
          service:
            name: demo-mcpgw
            port:
              number: 8080
```

It points at a Deployment (`74-demo-mcpgw-deployment.yaml`) that `k8s/deploy.sh` never applies, so the path 503s today.

- [ ] **Step 2: Append the second Ingress document**

At the end of `k8s/aws/se-ingress.yaml`:

```yaml
---
# Separate Ingress object, same host. rewrite-target is an Ingress-LEVEL
# annotation: putting it on ai-demo-ingress above would also rewrite the "/"
# frontend rule and break the app. Kubernetes allows multiple Ingress objects
# per host and nginx merges them.
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ai-demo-mcpgw-ingress
  namespace: <<NAMESPACE>>
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    # Strip the /mcpgw prefix so the container sees /mcp, not /mcpgw/mcp.
    # pathType: Prefix forwards the FULL path, so without this it 404s.
    nginx.ingress.kubernetes.io/use-regex: "true"
    nginx.ingress.kubernetes.io/rewrite-target: /$2
    # MCPGW terminates TLS itself locally; in-cluster nginx terminates instead
    # and proxies plain HTTP. Flip to HTTPS here if the container requires it.
    nginx.ingress.kubernetes.io/backend-protocol: "HTTP"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
spec:
  ingressClassName: nginx-public
  rules:
  - host: ai-demo.ping-devops.com
    http:
      paths:
      - path: /mcpgw(/|$)(.*)
        pathType: ImplementationSpecific
        backend:
          service:
            name: ping-mcpgw
            port:
              number: 8623
```

- [ ] **Step 3: Verify both documents parse and the frontend rule is untouched**

```bash
sed 's|<<NAMESPACE>>|ai-demo|g' k8s/aws/se-ingress.yaml | kubectl apply --dry-run=client -f -
```

Expected: two lines, `ingress.networking.k8s.io/ai-demo-ingress created (dry run)` and `ingress.networking.k8s.io/ai-demo-mcpgw-ingress created (dry run)`.

- [ ] **Step 4: Assert the rewrite did not leak onto the frontend Ingress**

```bash
sed 's|<<NAMESPACE>>|ai-demo|g' k8s/aws/se-ingress.yaml \
  | awk '/^kind: Ingress/,0' \
  | grep -n 'name:\|rewrite-target'
```

Expected: `rewrite-target` appears exactly once, and only after `name: ai-demo-mcpgw-ingress`. If it appears near `ai-demo-ingress`, stop — that configuration breaks the whole app on deploy.

- [ ] **Step 5: Assert no backend lacks a Deployment**

```bash
grep -A3 'backend:' k8s/aws/se-ingress.yaml | grep 'name:'
```

Expected: only `frontend` and `ping-mcpgw`. `demo-mcpgw` must be gone.

- [ ] **Step 6: Commit**

```bash
git add k8s/aws/se-ingress.yaml
git commit -m "feat(ping-mcpgw): route /mcpgw on the SE host, drop dead /mcp rule"
```

---

### Task 5: Operator documentation

**Files:**
- Modify: `ping-mcpgw/README.md`
- Modify: `ping-mcpgw/config/pingone.env.example`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: every decision from Tasks 1-4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `ping-mcpgw/README.md`**

Replace the "Quick start", "Install TLS certificates", and "Directory layout" sections so they describe what was actually built. The corrections:

- Start command is `./run-docker.sh optional start mcpgw`, not a bare `docker compose` line.
- No certs are generated. The existing `certs/api.ping.demo+2.pem` pair is mounted; it already covers `local.ping-devops.com` and is valid until Oct 2028.
- No `ssl/` directory is created.
- Local URL is `https://local.ping-devops.com:8623`; SE cluster URL is `https://ai-demo.ping-devops.com/mcpgw`.
- Both redirect URIs must be registered on the one Agentic App.
- `MCPGW_IMAGE` goes in the root `.env`.

Add a prerequisites note stating plainly that the deny policy and session recording are configured in the PingOne Privilege console, so a green test suite does not mean the demo works.

- [ ] **Step 2: Update `ping-mcpgw/config/pingone.env.example`**

Replace the placeholder `SERVER_URL` line with both concrete values:

```sh
# Public URL of this MCPGW. Local Docker Compose:
SERVER_URL=https://local.ping-devops.com:8623
# On the SE cluster instead use (nginx strips the /mcpgw prefix before it
# reaches the container, so this is what MCPGW advertises, not what it binds):
# SERVER_URL=https://ai-demo.ping-devops.com/mcpgw
```

- [ ] **Step 3: Add the CHANGELOG entry**

Under the current unreleased "Added" section, matching the existing bold-lead-in style:

```markdown
- **PingOne Privilege MCPGW wired into the stack** — `ping-mcpgw/` becomes a real service instead of a README. Profile-gated compose service `ping-mcpgw` on `https://local.ping-devops.com:8623` (compose network alias makes one cert-valid URL work for both the browser and the BFF's server-side relay), plus `k8s/75-ping-mcpgw-deployment.yaml` reachable at `https://ai-demo.ping-devops.com/mcpgw` through a second, separately-annotated Ingress object. The existing `/privilege-mcp-client` page needs no change: its default endpoint now comes from `PRIVILEGE_MCPGW_URL`. Also removes the dead `/mcp` ingress rule, whose backend Deployment was never applied by `k8s/deploy.sh`. Policy and session recording are configured in the PingOne Privilege console, not in this repo. `docker-compose.yml`, `run-docker.sh`, `k8s/{75-ping-mcpgw-deployment.yaml,deploy.sh,create-secrets.sh,aws/se-ingress.yaml}`, `demo_api_server/routes/privilegeMcpClient.js`, `ping-mcpgw/{README.md,config/pingone.env.example}`.
```

- [ ] **Step 4: Verify the emoji allowlist**

```bash
grep -nP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' ping-mcpgw/README.md CHANGELOG.md \
  | grep -vP '⚠️|✅|❌|🔐|✕|✓|👤|🔑|🪟|📚' || echo "allowlist clean"
```

Expected: `allowlist clean`.

- [ ] **Step 5: Commit**

```bash
git add ping-mcpgw/README.md ping-mcpgw/config/pingone.env.example CHANGELOG.md
git commit -m "docs(ping-mcpgw): document the real setup, hostnames, and console prerequisites"
```

---

### Task 6: Reconcile the spec and run the full gate

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-ping-mcpgw-design.md`

- [ ] **Step 1: Correct the spec's §5 config-flow diagram**

The spec shows `env_file:` delivering the OIDC values. Replace that arrow with the directory mount to `/var/lib/procyon/config`, and add a sentence noting the vendor reads the file directly. Keep the "env_file only, never environment" warning as a general repo rule but mark it not-applicable to this service.

- [ ] **Step 2: Run the BFF suite**

```bash
cd demo_api_server && CI=true npm test -- --forceExit
```

Expected: green. Paste the summary line — this is the evidence required before claiming done.

- [ ] **Step 3: Confirm no generated artifacts were staged**

```bash
git status --short | grep -E 'data/(step-verification|goldens)' || echo "no generated artifacts staged"
```

Expected: `no generated artifacts staged`. The BFF suite rewrites hundreds of files under `demo_api_server/data/`; none belong in this branch.

- [ ] **Step 4: Confirm the whole diff is intentional**

```bash
git diff origin/main --stat
```

Expected: exactly the 11 files from the File Structure table plus the two spec/plan docs. Anything else is drive-by and must be reverted.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-29-ping-mcpgw-design.md
git commit -m "docs(ping-mcpgw): correct spec config flow to a file mount"
```

---

## Deferred to the console step

These cannot be done from the repo and are not tasks:

1. Create the `MCPGW` Agentic App; register both redirect URIs; capture client id and secret into `ping-mcpgw/config/pingone.env`.
2. Run the gateway wizard; put the resulting image URI in root `.env` as `MCPGW_IMAGE` and swap `MCPGW_IMAGE_PLACEHOLDER` in `k8s/75-ping-mcpgw-deployment.yaml`.
3. Register the MCP Server tile against `http://mcp-server:8080/mcp`.
4. Author the tool policy that produces the DENY.
5. Enable session recording.

## Post-image verification

Once `MCPGW_IMAGE` exists, these are the checks that actually prove the demo — none are runnable before then:

```bash
# container up
./run-docker.sh optional start mcpgw && docker ps --filter name=ai-demo-ping-mcpgw

# browser-side TLS
curl -sS -o /dev/null -w '%{http_code}\n' https://local.ping-devops.com:8623/

# BFF-side reachability — MUST run inside the container. Reaching 8623 from the
# host proves nothing about the network alias, and the alias is the load-bearing
# part of the design.
docker exec ai-demo-api-server node -e \
  "fetch('https://local.ping-devops.com:8623/mcp').then(r=>console.log(r.status)).catch(e=>console.error(e.message))"
```

Then, through the `/privilege-mcp-client` page: `tools/list` returns mcp-server's banking tools; a policy-blocked call renders a deny; that session appears in the Privilege console recording view. Finally repeat against `https://ai-demo.ping-devops.com/mcpgw`, and confirm `https://ai-demo.ping-devops.com/` still serves the frontend.

## Known risk carried into implementation

Whether MCPGW accepts the client page's bearer token or demands its own browser login is unknown until the image runs. Tell: HTTP 401 at `/mcp` with a token that is otherwise valid. If that happens, stop — the fallbacks in spec §3 are unscoped and need a new design round. Do not work around it by disabling TLS verification or by loosening the authorization path.
