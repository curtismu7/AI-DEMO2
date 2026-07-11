# ff_tracing Quick Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ff_tracing` toggle to the Quick Flags pill that turns OpenTelemetry→Jaeger tracing on/off for the Docker stack via the existing mark-and-sync (`run-docker.sh demo-sync`) reconciliation.

**Architecture:** A boolean flag in configStore records desired state (default ON). Tracing is the compose default (both `docker compose up -d` and `./run-docker.sh` trace on a fresh clone); `demo-sync` reads the flag and, when OFF, stops Jaeger and recreates the 7 instrumented services with an empty OTLP endpoint so the `otel-instrument.js` preload no-ops. The pill flip writes configStore; the user runs `demo-sync` to apply — identical to the existing gateway/authz flags.

**Tech Stack:** Node/Express (BFF), React/Vite (UI), Docker Compose, Bash (`run-docker.sh`), Jest.

## Global Constraints

- **Worktree only:** all edits/commits happen in `.claude/worktrees/ff-tracing` on branch `feat/ff-tracing-quick-flag`. Stage explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **Emoji allowlist:** only `⚠️ ✅ ❌ 🔐 ✕ ✓` in any code/UI/text. Everything else plain text or CSS.
- **Minimal diff:** name the element, change only that. No adjacent cleanup.
- **Do NOT break** auth/OAuth, RFC 8693 token exchange, BFF sessions, admin/customer role enforcement, HITL consent, ports/hosts, or the behavior of existing Quick Flags and the invariant flags `ff_heuristic_enabled`, `ff_authorize_simulated`, `ff_gateway_brokered_exchange`.
- **`ff_tracing` must stay UN-pinned:** do NOT add it to `PINNED_ENV_ALIASES` (featureFlags.js) or the `envFallbackMap` (configStore.js). That is what keeps it a live toggle, not a locked 🔐.
- **The 7 instrumented services** (the ones that mount `otel-instrument.js` and set `OTEL_EXPORTER_OTLP_ENDPOINT`): `demo-api-server`, `mcp-server`, `mcp-gateway`, `agent-service`, `hitl-service`, `mcp-invest`, `authz-server`.
- **UI build gate:** after any `demo_api_ui/` change, `cd demo_api_ui && npm run build` must exit 0 before the task is done.
- **Run jest from a worktree** with: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath <file>` (repo jest config ignores `.claude/worktrees/` paths).

---

## File Structure

- `demo_api_server/routes/featureFlags.js` — add `ff_tracing` to `FLAG_REGISTRY` (Observability category). No `PINNED_ENV_ALIASES` entry.
- `demo_api_server/services/configStore.js` — add `ff_tracing` to `FIELD_DEFS` (`{public:true, default:'true'}`). No `envFallbackMap` entry.
- `docker-compose.yml` — make the 7 `OTEL_EXPORTER_OTLP_ENDPOINT` values interpolation-with-default; remove `profiles: ["tracing"]` from `jaeger`; add `mem_limit: 512m` to `jaeger`.
- `run-docker.sh` — `_read_demo_stack_flags` reads `ff_tracing`; `cmd_demo_sync` reconciles Jaeger + the 7 services.
- `demo_api_ui/src/components/QuickFlagsPill.js` — add "Tracing" to `QUICK_FLAGS` and "Observability" to `GROUPS`.
- `.env` — remove the `COMPOSE_PROFILES=tracing` line (courtesy cleanup).
- Tests: extend `demo_api_server/tests/featureFlagsPinned.test.js` (new: ff_tracing not pinned) and add a registry-presence assertion.

---

## Task 1: Register the `ff_tracing` flag (BFF)

**Files:**
- Modify: `demo_api_server/routes/featureFlags.js` (add to `FLAG_REGISTRY`, after the HITL block ~line 160)
- Modify: `demo_api_server/services/configStore.js` (add to `FIELD_DEFS`, near `ff_hitl_enabled` line 275)
- Test: `demo_api_server/tests/featureFlagsPinned.test.js` (extend)

**Interfaces:**
- Consumes: `FLAG_REGISTRY`, `serializeFlag` (already exported from featureFlags.js).
- Produces: flag id `ff_tracing` (boolean, defaultValue `true`), resolvable via `configStore.getEffective('ff_tracing')`.

- [ ] **Step 1: Write the failing test** — append to `demo_api_server/tests/featureFlagsPinned.test.js`:

```javascript
describe('ff_tracing flag registration', () => {
  test('exists in registry as a boolean defaulting to true', () => {
    const f = flagById('ff_tracing');
    expect(f).toBeDefined();
    expect(f.type).toBe('boolean');
    expect(f.defaultValue).toBe(true);
    expect(f.category).toBe('Observability');
  });

  test('is NOT pinned even when OTEL endpoint env is set (unlocked toggle)', () => {
    const saved = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://jaeger:4317';
    try {
      const out = serializeFlag(flagById('ff_tracing'));
      expect(out.pinned).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = saved;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/featureFlagsPinned.test.js`
Expected: FAIL — `flagById('ff_tracing')` is `undefined`.

- [ ] **Step 3: Add the flag to `FLAG_REGISTRY`** — in `demo_api_server/routes/featureFlags.js`, insert after the HITL `hitl_consent_mfa_mode` object (before the `// ── MCP Server ──` comment, ~line 161):

```javascript
  // ── Observability ──────────────────────────────────────────────────────────
  {
    id:           'ff_tracing',
    name:         'Tracing — OpenTelemetry → Jaeger',
    category:     'Observability',
    description:
      'Export OpenTelemetry spans from the BFF and cooperating services to Jaeger. ' +
      'Change takes effect after container reconciliation: run `./run-docker.sh demo-sync` ' +
      '(Docker) to start/stop Jaeger and recreate the instrumented services.',
    impact:       'ON = services export spans to Jaeger and the Tracing page shows call paths. OFF = Jaeger is stopped and services boot with tracing disabled.',
    type:         'boolean',
    defaultValue: true,
  },
```

- [ ] **Step 4: Add the flag to `FIELD_DEFS`** — in `demo_api_server/services/configStore.js`, add next to `ff_hitl_enabled` (~line 275):

```javascript
  ff_tracing:                  { public: true, default: 'true'  }, // OTel→Jaeger tracing; reconciled by run-docker.sh demo-sync
```

- [ ] **Step 5: Run test to verify it passes**

Run: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/featureFlagsPinned.test.js`
Expected: PASS (all tests, including the existing pinned tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/featureFlags.js demo_api_server/services/configStore.js demo_api_server/tests/featureFlagsPinned.test.js
git commit -m "feat(flags): register ff_tracing (Observability, default ON, unpinned)"
```

---

## Task 2: Compose — tracing-on default, overridable, capped

**Files:**
- Modify: `docker-compose.yml` (7 `OTEL_EXPORTER_OTLP_ENDPOINT` lines: 81, 286, 400, 448, 486, 519, 577; `jaeger` service ~lines 55-65)

**Interfaces:**
- Consumes: nothing.
- Produces: a `jaeger` service that starts on a bare `docker compose up -d`; an OTLP endpoint that defaults to `http://jaeger:4317` but is overridable via the `OTEL_EXPORTER_OTLP_ENDPOINT` shell env at recreate time.

- [ ] **Step 1: Make all 7 endpoint values interpolation-with-default** — replace each occurrence (there are exactly 7, all identical) in `docker-compose.yml`:

Find (each): `      OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4317"`
Replace (each): `      OTEL_EXPORTER_OTLP_ENDPOINT: "${OTEL_EXPORTER_OTLP_ENDPOINT-http://jaeger:4317}"`

(Use `-` not `:-` so that an explicitly-empty value from demo-sync disables tracing; `:-` would fall back to the default on empty. Verify count in Step 3.)

- [ ] **Step 2: Un-gate Jaeger and add a memory cap** — in the `jaeger` service block, delete the `profiles: ["tracing"]` line and add `mem_limit: 512m`. Result:

```yaml
  # ── Jaeger UI + OTLP collector (free local tracing backend) ────────────────
  jaeger:
    image: jaegertracing/all-in-one:1.62.0
    container_name: ai-demo-jaeger
    mem_limit: 512m
    ports:
      - "16686:16686"   # Jaeger UI
      - "4317:4317"     # OTLP gRPC
    environment:
      - COLLECTOR_OTLP_ENABLED=true
    networks:
      - ai-demo
```

- [ ] **Step 3: Verify the compose file parses and the edits are complete**

Run:
```bash
grep -c 'OTEL_EXPORTER_OTLP_ENDPOINT: "${OTEL_EXPORTER_OTLP_ENDPOINT-http://jaeger:4317}"' docker-compose.yml
grep -c 'profiles: \["tracing"\]' docker-compose.yml
docker compose config --services | grep -x jaeger
```
Expected: `7`, then `0`, then `jaeger` printed (jaeger now in the default service set).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): tracing on by default, overridable endpoint, jaeger mem cap"
```

---

## Task 3: demo-sync reconciliation (`run-docker.sh`)

**Files:**
- Modify: `run-docker.sh` (`_read_demo_stack_flags` ~line 849; `cmd_demo_sync` ~line 866)

**Interfaces:**
- Consumes: `configStore.getEffective('ff_tracing')` via `docker exec ai-demo-api-server`.
- Produces: Jaeger + the 7 instrumented services reconciled to match `ff_tracing`.

- [ ] **Step 1: Extend `_read_demo_stack_flags` to also read `ff_tracing`** — update the function body so it prints a third 0/1 token, defaulting to `1` (tracing on) on failure. Replace the `docker exec` node script and the fallback:

```bash
_read_demo_stack_flags() {
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'ai-demo-api-server'; then
    echo "0 1 1"
    return 0
  fi
  docker exec ai-demo-api-server node -e "
    const cs = require('./services/configStore');
    const t = (v) => (v === true || v === 'true') ? '1' : '0';
    const sim = t(cs.getEffective('ff_authorize_simulated'));
    const pgw = t(cs.getEffective('ff_mcp_gateway_pinggateway'));
    const trc = (cs.getEffective('ff_tracing') === false || cs.getEffective('ff_tracing') === 'false') ? '0' : '1';
    process.stdout.write(sim + ' ' + pgw + ' ' + trc);
  " 2>/dev/null || echo "0 1 1"
}
```

(Default `trc=1`: absent/unset flag means tracing ON, matching the compose default.)

- [ ] **Step 2: Parse the third token in `cmd_demo_sync`** — after the existing `sim=`/`pgw=` parsing, add:

```bash
  local trc
  trc="$(echo "${flags}" | awk '{print $3}')"
  [[ -z "${trc}" ]] && trc=1
```

(Change the existing `pgw="${flags##* }"` line to `pgw="$(echo "${flags}" | awk '{print $2}')"` so the trailing-token trick doesn't grab `trc`.)

- [ ] **Step 3: Add the tracing reconcile block** — at the end of `cmd_demo_sync`, before the final `echo ""`:

```bash
  # Tracing (ff_tracing): OFF stops Jaeger and recreates the instrumented
  # services with an empty OTLP endpoint so otel-instrument.js no-ops. ON is the
  # compose default — ensure Jaeger is up.
  local otel_services="demo-api-server mcp-server mcp-gateway agent-service hitl-service mcp-invest authz-server"
  if [[ "${trc}" == "0" ]]; then
    ok "Tracing OFF — stopping Jaeger and recreating instrumented services without OTLP export"
    docker compose "${COMPOSE_FILES[@]}" stop jaeger 2>/dev/null || true
    OTEL_EXPORTER_OTLP_ENDPOINT="" \
      docker compose "${COMPOSE_FILES[@]}" up -d --force-recreate --no-deps ${otel_services} >/dev/null 2>&1 || true
  else
    ok "Tracing ON — ensuring Jaeger is up"
    docker compose "${COMPOSE_FILES[@]}" up -d --no-deps jaeger >/dev/null 2>&1 || true
  fi
```

- [ ] **Step 4: Shellcheck / syntax verify**

Run: `bash -n run-docker.sh && echo "syntax ok"`
Expected: `syntax ok`.

- [ ] **Step 5: Commit**

```bash
git add run-docker.sh
git commit -m "feat(run-docker): reconcile ff_tracing in demo-sync"
```

---

## Task 4: The Quick Flags pill (UI)

**Files:**
- Modify: `demo_api_ui/src/components/QuickFlagsPill.js` (`QUICK_FLAGS` ~lines 16-29; `GROUPS` line 30)

**Interfaces:**
- Consumes: `GET/PATCH /api/admin/feature-flags` (already wired); the `ff_tracing` flag from Task 1.
- Produces: a "Tracing" toggle row rendered under an "Observability" group.

- [ ] **Step 1: Add "Observability" to `GROUPS`** — change line 30:

```javascript
const GROUPS = ['Token & Gateway', 'AuthN / AuthZ', 'Agent', 'Observability'];
```

- [ ] **Step 2: Add the Tracing entry to `QUICK_FLAGS`** — append as the last element of the array (after `ff_helix_lmstudio_fallback`):

```javascript
  { id: 'ff_tracing',                   group: 'Observability',   control: 'toggle',    label: 'Tracing (OTel → Jaeger)' },
```

- [ ] **Step 3: Run the UI build gate**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0 (build succeeds).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/QuickFlagsPill.js
git commit -m "feat(ui): add Tracing toggle to Quick Flags pill"
```

---

## Task 5: `.env` cleanup + end-to-end verification

**Files:**
- Modify: `.env` (remove `COMPOSE_PROFILES=tracing`)

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified working toggle across both launch paths.

- [ ] **Step 1: Remove the redundant profile line** — delete the `COMPOSE_PROFILES=tracing` line (and its comment) from `.env`. It is redundant now that Jaeger is un-gated. (`.env` is gitignored — no commit for this file.)

- [ ] **Step 2: Verify bare-compose path traces (default ON)**

Run:
```bash
docker compose up -d --force-recreate demo-api-server jaeger
sleep 8
docker logs ai-demo-api-server 2>&1 | grep -m1 '\[otel\]'
curl -s http://localhost:16686/api/services | grep -o demo-api-server
```
Expected: `[otel] tracing to http://jaeger:4317 as demo-api-server`; `demo-api-server` present in Jaeger.

- [ ] **Step 3: Verify OFF path** — set the flag off and reconcile:

```bash
curl -s -X PATCH http://localhost:3001/api/admin/feature-flags \
  -H 'Content-Type: application/json' \
  --cookie "$(cat .demo-admin-cookie 2>/dev/null)" \
  -d '{"updates":{"ff_tracing":false}}'
./run-docker.sh demo-sync
sleep 8
docker ps --filter name=ai-demo-jaeger --format '{{.Names}}' | grep -c jaeger || echo "jaeger stopped (expected 0)"
docker logs ai-demo-api-server 2>&1 | tail -20 | grep -c '\[otel\] tracing to' || echo "no new otel export (expected)"
```
Expected: Jaeger not running (count 0); the recreated api-server shows no new `[otel] tracing to` line (endpoint empty → no-op). If admin cookie auth is unavailable in the harness, toggle via the pill UI instead and note it.

- [ ] **Step 4: Verify ON path restores tracing**

```bash
curl -s -X PATCH http://localhost:3001/api/admin/feature-flags \
  -H 'Content-Type: application/json' --cookie "$(cat .demo-admin-cookie 2>/dev/null)" \
  -d '{"updates":{"ff_tracing":true}}'
./run-docker.sh demo-sync
sleep 8
curl -s http://localhost:16686/api/services | grep -o demo-api-server
```
Expected: `demo-api-server` present again.

- [ ] **Step 5: Confirm no config assumed Jaeger off-by-default (success criterion 7)**

Run: `grep -rniE 'profiles:.*tracing|COMPOSE_PROFILES' . --include=*.yml --include=*.sh --include=*.md | grep -v node_modules | grep -v '.claude/worktrees'`
Expected: no remaining references that would re-gate Jaeger (review any hits; the `.env` line is gone). Note findings.

- [ ] **Step 6: Run the featureFlags test suite once more (regression)**

Run: `./node_modules/.bin/jest --testPathIgnorePatterns=/node_modules/ --runTestsByPath demo_api_server/tests/featureFlagsPinned.test.js demo_api_server/src/__tests__/featureFlags.route.test.js`
Expected: PASS.

- [ ] **Step 7: Final review + REGRESSION_PLAN §4 note (optional)**

If any behavior touched a protected area, add a §4 entry. For this feature (additive flag + infra), a §4 entry is optional; note the decision.

---

## Self-Review

**Spec coverage:** Touch points 1-5 map to Tasks 1 (flag), 2 (compose), 3 (demo-sync), 4 (pill), 5 (.env + verify). Success criteria 1-7 map to Task 5 steps 2-6. ✓

**Placeholder scan:** All code blocks contain concrete content; test code is complete; commands have expected output. The only conditional is Task 5 admin-cookie auth, with a stated UI fallback. ✓

**Type consistency:** flag id `ff_tracing` used identically in featureFlags.js, configStore.js, run-docker.sh, QuickFlagsPill.js, and tests. `OTEL_EXPORTER_OTLP_ENDPOINT` env name consistent. `otel_services`/`otel_services` list matches the 7-service constraint. ✓
