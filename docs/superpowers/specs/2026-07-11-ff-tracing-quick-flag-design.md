# ff_tracing Quick Flag — Design

**Date:** 2026-07-11
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/ff-tracing-quick-flag`

## Problem

Tracing (OpenTelemetry spans → Jaeger) is enabled entirely at container-boot
time: each of the 7 instrumented Node services reads `OTEL_EXPORTER_OTLP_ENDPOINT`
once at startup via the `-r /otel/otel-instrument.js` preload, and Jaeger is a
Docker Compose service. There is no way for a user to turn tracing on/off from
the app — it requires editing env and recreating containers by hand. The user
wants a toggle on the existing **Quick Flags** pill.

Because the services boot their OTel SDK once from env and do not share the
BFF's configStore, a pill flag cannot flip tracing live in-process. It can only
record desired state that a **container recreate** then applies — exactly the
model the existing gateway/authz Quick Flags already use (`run-docker.sh
demo-sync` reconciles containers to match configStore flags).

## Decisions (locked)

- **Reconcile model:** mark-and-sync, identical to `ff_authorize_simulated` /
  `ff_mcp_gateway_pinggateway`. Flip writes configStore; `./run-docker.sh
  demo-sync` applies it. No BFF-shells-out-to-docker auto-recreate.
- **Default:** tracing **ON**. The flag's job is to let you turn it *off* and
  slim the stack, not to turn it on.
- **Both launch paths work on a fresh clone:** a bare `docker compose up -d`
  and `./run-docker.sh` both trace out of the box.
- **Scope:** Docker Compose path only. Native `./run.sh` keeps its current
  auto-start-Jaeger behavior; the pill toggle does not drive native processes.

## Footprint (verified 2026-07-11, not a concern)

- Jaeger image: 114 MB on disk, pulled once. Storage is **in-memory only** (no
  volume for trace data; only an ephemeral `/tmp` mount) — no disk growth,
  traces reset on restart.
- Live RAM: ~288 MiB (~1.8% of a 16 GiB host).
- **K8s is unaffected by this change.** `k8s/73-jaeger-deployment.yaml` already
  exists and is already applied by default (`k8s/deploy.sh`), capped at
  `limits.memory: 512Mi` / `500m` CPU, in-memory, no PVC. "Default on" for
  Compose merely matches what K8s already does.

## Changes (5 touch points)

### 1. Flag registry
- Add `ff_tracing` (boolean, `defaultValue: true`, category "Observability") to
  `FLAG_REGISTRY` in `demo_api_server/routes/featureFlags.js`.
- Add a matching `FIELD_DEFS` entry (`{public:true, default:true}`) in
  `demo_api_server/services/configStore.js`.
- **Do NOT** add it to `PINNED_ENV_ALIASES` or configStore's `envFallbackMap` —
  that is what keeps it a live toggle rather than a locked 🔐 pinned flag.

### 2. Compose = tracing-on default, but overridable
In `docker-compose.yml`:
- Change the 7 services' `OTEL_EXPORTER_OTLP_ENDPOINT: "http://jaeger:4317"` to
  `"${OTEL_EXPORTER_OTLP_ENDPOINT:-http://jaeger:4317}"`. A hardcoded literal
  cannot be overridden at recreate time; interpolation-with-default keeps the
  bare-`up` default while letting demo-sync inject an empty value to disable.
- Remove `profiles: ["tracing"]` from the `jaeger` service so it starts on a
  plain `docker compose up -d` on a fresh clone (no local `.env` required).
- Add `mem_limit: 512m` to the `jaeger` service for parity with the K8s cap.

### 3. demo-sync reconciliation (`run-docker.sh`)
- Extend `_read_demo_stack_flags` to also read `ff_tracing` from the BFF
  configStore (`docker exec ai-demo-api-server node -e "...getEffective('ff_tracing')"`),
  appending a 0/1 token; keep the existing safe fallback.
- In `cmd_demo_sync`:
  - **OFF** → stop `jaeger`; `--force-recreate --no-deps` the 7 instrumented
    services with `OTEL_EXPORTER_OTLP_ENDPOINT=` (empty) so the instrument
    script no-ops (`if (!otlpEndpoint) return;`).
  - **ON** → ensure `jaeger` is up (compose default; effectively a no-op when
    already running).
- The 7 services: `demo-api-server`, `mcp-server`, `mcp-gateway`,
  `agent-service`, `hitl-service`, `mcp-resource-server`, `authz-server` (the set that
  mounts `otel-instrument.js`, per docker-compose.yml).

### 4. The pill (`demo_api_ui/src/components/QuickFlagsPill.js`)
- Add a "Tracing" entry to the curated `QUICK_FLAGS` list (new or existing
  "Observability"/"Agent" group), using the same "pending — run sync"
  affordance the other reconcile-flags already render.
- Emoji allowlist honored (⚠️ ✅ ❌ 🔐 ✕ ✓ only). Minimal diff.
- UI build gate: `cd demo_api_ui && npm run build` must exit 0.

### 5. `.env` cleanup
- Drop the local `COMPOSE_PROFILES=tracing` line added earlier — redundant now
  that `jaeger` is not profile-gated. (Local/gitignored; a courtesy cleanup.)

## Non-goals (YAGNI)
- No auto-recreate from the BFF.
- No native-mode (`./run.sh`) process toggling.
- No per-service tracing granularity — one flag, whole stack.
- No persistent trace storage / sampling config.

## Invariants preserved (regression-guard)
- No change to auth/OAuth, RFC 8693 token exchange, BFF sessions, admin/customer
  role enforcement, HITL consent, or ports/hosts.
- No change to the behavior of existing Quick Flags or the deployment-invariant
  flags `ff_heuristic_enabled`, `ff_authorize_simulated`,
  `ff_gateway_brokered_exchange` — `ff_tracing` reconciliation is additive in
  `cmd_demo_sync`.

## Success criteria
1. Fresh `docker compose up -d` (no local `.env`) → Jaeger up, `/tracing` shows
   app traces for `demo-api-server`.
2. `./run-docker.sh` path → same.
3. Pill shows "Tracing" ON by default, unlocked (no 🔐).
4. Flip OFF → `./run-docker.sh demo-sync` → Jaeger stopped, the 7 services
   recreated without the endpoint, `/tracing` reports Jaeger unreachable; no
   OTel export attempts in their logs.
5. Flip ON → demo-sync → traces flow again.
6. `cd demo_api_ui && npm run build` exits 0.
7. No memory-profile config or CI assumed Jaeger was off-by-default (verify).
