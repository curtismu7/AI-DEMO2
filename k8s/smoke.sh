#!/usr/bin/env bash
# smoke.sh — post-deploy smoke checks for the SE/EKS cluster.
#
# Verifies the invariants that have actually broken live deploys, in the order
# a demo would hit them. Run automatically by se-update-code.sh after deploy,
# or by hand:
#
#   SE_NAMESPACE=ping-devops-<you> ./k8s/smoke.sh
#   ./k8s/smoke.sh ping-devops-<you>
#
# Optional env:
#   APP_URL                  — public origin (default https://ai-demo.ping-devops.com)
#   DEPLOY_START_EPOCH       — unix epoch of deploy start; any pod started BEFORE it
#                              is flagged stale (catches deploy.sh dying mid-rollout
#                              and leaving services on pre-push images)
#   SMOKE_CHECK_DEPLOYMENTS  — space-separated deployment names; when set, check 2/7
#                              only flags staleness for these (a single-service targeted
#                              push, e.g. se-update-code.sh <service>, never touches every
#                              other deployment, so checking all of them there is a
#                              guaranteed false positive, not a real signal). Unset (the
#                              full-deploy path) checks every deployment, as before.
#
# Checks (each prints PASS/FAIL; exits 1 if any failed):
#   1. every deployment's rollout is complete
#   2. no pod predates DEPLOY_START_EPOCH (when provided)
#   3. GET $APP_URL/api/health returns "healthy"
#   4. BFF vault-bridge service key == api-resource-server key (apikey-dispatch)
#   5. llm-proxy answers /v1/models (LLM modes usable)
#   6. authz sidecar canary: a McpToolsList decision with the gateway's own
#      comma-joined resource URI as TokenAudience is not DENYed invalid_aud
#      (regression: tools/list DENY hid every vertical chip)
#   7. Code Explorer SSE first byte arrives quickly (nginx must not buffer)

set -uo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
info() { echo -e "${BLUE}[SMOKE]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILURES=$((FAILURES + 1)); }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

NS="${1:-${SE_NAMESPACE:-}}"
[ -n "$NS" ] || { echo "Usage: SE_NAMESPACE=ping-devops-<you> $0  (or pass the namespace as arg 1)" >&2; exit 2; }
APP_URL="${APP_URL:-https://ai-demo.ping-devops.com}"
FAILURES=0

kexec() { kubectl exec -n "$NS" "$@" 2>/dev/null; }

# ── 0. cluster reachable (an expired OIDC token must not fake a PASS) ─────────
DEPLOYMENTS=$(kubectl get deployments -n "$NS" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null)
if [ -z "$DEPLOYMENTS" ]; then
  echo -e "${RED}[SMOKE] cannot list deployments in $NS — kubectl auth expired or wrong context/namespace. Run any kubectl command to re-auth (browser sign-in), then re-run.${NC}" >&2
  exit 2
fi

# ── 1. rollout completeness ───────────────────────────────────────────────────
info "1/7 rollout status of every deployment in $NS (llm stack can take minutes after restart)..."
ROLLOUT_FAILED=""
for dep in $DEPLOYMENTS; do
  # Skip deployments scaled to zero — these are intentionally dormant (optional
  # agents, CPU-only LLM tiers) and `rollout status` hangs/fails on them.
  DESIRED=$(kubectl get deployment "$dep" -n "$NS" -o jsonpath='{.spec.replicas}' 2>/dev/null)
  [ "${DESIRED:-0}" -eq 0 ] && continue
  if ! kubectl rollout status "deployment/$dep" -n "$NS" --timeout=300s >/dev/null 2>&1; then
    ROLLOUT_FAILED="$ROLLOUT_FAILED $dep"
  fi
done
if [ -n "$ROLLOUT_FAILED" ]; then
  fail "rollouts incomplete:$ROLLOUT_FAILED"
else
  pass "all rollouts complete"
fi

# ── 2. stale pods (deploy.sh died mid-restart) ────────────────────────────────
if [ -n "${DEPLOY_START_EPOCH:-}" ]; then
  info "2/7 checking no pod predates deploy start..."
  STALE=""
  while IFS=$'\t' read -r name start; do
    [ -n "$start" ] || continue
    # jaeger is tracing infra — its image never changes with app deploys and
    # deploy.sh deliberately doesn't restart it, so it always predates deploys.
    case "$name" in jaeger-*) continue ;; esac
    # k8s startTime is UTC ("...Z"): parse with -u on BOTH platforms. Without it
    # macOS `date -j -f` read the timestamp as LOCAL time, inflating start
    # epochs by the UTC offset — pods up to ~5h stale passed as fresh (this
    # masked a demo-api-server that deploy.sh's llm-proxy timeout never
    # restarted, 2026-07-11).
    start_epoch=$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$start" +%s 2>/dev/null || date -u -d "$start" +%s 2>/dev/null || echo 0)
    if [ "$start_epoch" -ne 0 ] && [ "$start_epoch" -lt "$DEPLOY_START_EPOCH" ]; then
      # Pod name = <deployment>-<rs-hash>-<pod-hash>: strip the last TWO
      # segments (%%-* kept only the first segment, e.g. "demo").
      dep="${name%-*-*}"
      # Single-service targeted push: only this run's own deployment(s) are
      # expected to be fresh — every other running pod legitimately predates
      # it, so skip anything not in the allowlist instead of false-failing.
      if [ -n "${SMOKE_CHECK_DEPLOYMENTS:-}" ]; then
        case " $SMOKE_CHECK_DEPLOYMENTS " in *" $dep "*) ;; *) continue ;; esac
      fi
      STALE="$STALE $dep"
    fi
  done < <(kubectl get pods -n "$NS" -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.startTime}{"\n"}{end}')
  if [ -n "$STALE" ]; then
    fail "pods running PRE-deploy images:$STALE"
    warn "remediation: kubectl rollout restart deployment$(echo "$STALE" | tr ' ' '\n' | sort -u | sed 's/^/ /' | tr -d '\n') -n $NS"
  else
    pass "every pod started after deploy began"
  fi
else
  info "2/7 skipped (DEPLOY_START_EPOCH not set)"
fi

# ── 3. public health endpoint ─────────────────────────────────────────────────
info "3/7 GET $APP_URL/api/health ..."
HEALTH_OK=""
for _ in 1 2 3; do
  if curl -skf --max-time 15 "$APP_URL/api/health" | grep -q '"status":"healthy"'; then HEALTH_OK=1; break; fi
  sleep 5
done
if [ -n "$HEALTH_OK" ]; then pass "api health is healthy"; else fail "$APP_URL/api/health not healthy"; fi

# ── 4. apikey-dispatch key alignment (bridge vs backend) ──────────────────────
# The BFF vault bridge serves DEMO_API_RESOURCE_SERVER_KEY; api-resource-server
# validates X-API-Key against API_RESOURCE_SERVER_API_KEY. If they differ, every
# invest/mortgage chip fails "backend rejected the service API key".
info "4/7 service API key alignment (BFF bridge vs api-resource-server)..."
BRIDGE_HASH=$(kexec deploy/demo-api-server -- sh -c 'printenv DEMO_API_RESOURCE_SERVER_KEY | tr -d "\n" | sha256sum' | cut -c1-16)
BACKEND_HASH=$(kexec deploy/api-resource-server -- sh -c 'printenv API_RESOURCE_SERVER_API_KEY | tr -d "\n" | sha256sum' | cut -c1-16)
EMPTY_HASH="e3b0c44298fc1c14" # sha256("")
if [ -z "$BRIDGE_HASH" ] || [ "$BRIDGE_HASH" = "$EMPTY_HASH" ]; then
  fail "BFF has no DEMO_API_RESOURCE_SERVER_KEY env — bridge will serve the committed default (create-secrets.sh align_service_api_keys should provision it)"
elif [ "$BRIDGE_HASH" != "$BACKEND_HASH" ]; then
  fail "service key mismatch: bridge=$BRIDGE_HASH backend=$BACKEND_HASH — invest/mortgage chips will 401"
else
  pass "service key aligned (hash $BRIDGE_HASH)"
fi

# ── 5. llm-proxy answers ──────────────────────────────────────────────────────
info "5/7 llm-proxy /v1/models (retries while a tier is still loading)..."
LLM_OK=""
for _ in 1 2 3 4 5; do
  CODE=$(kexec deploy/demo-api-server -- node -e '
    require("http").get("http://llm-proxy:8090/v1/models",{timeout:8000},r=>{console.log(r.statusCode);process.exit(0)})
      .on("error",()=>{console.log(0);process.exit(0)});' | tail -1)
  [ "$CODE" = "200" ] && { LLM_OK=1; break; }
  sleep 20
done
if [ -n "$LLM_OK" ]; then pass "llm-proxy serving models"; else fail "llm-proxy not answering /v1/models — LLM agent modes will fall back to the heuristics catalog"; fi

# ── 6. authz tools/list canary — must PERMIT ─────────────────────────────────
# Replays the EXACT decision request the Node gateway sends for tools/list
# (pingAuthorizeGuard.ts): comma-joined MCP_GW_RESOURCE_URI as TokenAudience/
# McpResourceUri, UserId, empty ActClientId, Vertical, CandidateTools. Any
# non-PERMIT means real discovery is denied → the BFF degrades to the local
# catalog → vertical chips ride the fallback. SMOKE_SUB must be a real,
# enabled PingOne user (Rule 0a2 user lookup); defaults to the demo user of
# env 01d89b06-… — override for other PingOne environments.
SMOKE_SUB="${SMOKE_SUB:-1aee74ae-3d09-4bcf-a69f-7e1bc225b761}"
info "6/7 authz tools/list canary (full gateway parameter shape, expect PERMIT)..."
# Skip terminating pods: right after a rollout the label selector also matches
# the old pod (still phase=Running but with deletionTimestamp set), and
# exec'ing into it dies silently (empty canary → phantom FAIL — hit on the
# 2026-07-11 verification run).
GW_POD=$(kubectl get pods -n "$NS" -l component=mcp-gateway \
  -o jsonpath='{range .items[*]}{.metadata.name} {.metadata.deletionTimestamp}{"\n"}{end}' 2>/dev/null \
  | awk 'NF==1 {print $1; exit}')
if [ -z "$GW_POD" ]; then
  fail "no mcp-gateway pod found"
else
  CANARY=$(SMOKE_SUB="$SMOKE_SUB" kubectl exec -n "$NS" "$GW_POD" -c mcp-gateway -- env SMOKE_SUB="$SMOKE_SUB" node -e '
    const aud = process.env.MCP_GW_RESOURCE_URI || "mcpgateway.ping.demo";
    const sub = process.env.SMOKE_SUB;
    const body = JSON.stringify({ parameters: {
      DecisionContext: "McpToolsList",
      ClientId: sub,
      UserId: sub,
      ActClientId: "",
      TokenAudience: aud,
      TokenAudActual: aud,
      McpResourceUri: aud,
      TokenScopes: "gateway:mcp:invoke",
      ActiveVertical: "",
      Vertical: "",
      CandidateTools: "[]",
    }});
    const req = require("http").request({ host: "127.0.0.1", port: 9001,
      path: "/governance/pap/alpha/policy/smoke-canary/decision", method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 8000 },
      res => { let b = ""; res.on("data", c => b += c); res.on("end", () => { console.log(b); process.exit(0); }); });
    req.on("error", e => { console.log(JSON.stringify({ error: e.message })); process.exit(0); });
    req.end(body);' 2>/dev/null | tail -1)
  if echo "$CANARY" | grep -q '"decision":"PERMIT"'; then
    pass "authz PERMITs the gateway tools/list shape"
  elif echo "$CANARY" | grep -q '"error"'; then
    fail "authz sidecar unreachable from mcp-gateway: $CANARY"
  else
    fail "authz does not PERMIT the gateway tools/list shape — discovery is degraded, vertical chips ride the fallback catalog: $CANARY"
  fi
fi

# ── 7. Code Explorer SSE must stream immediately (no nginx buffering) ─────────
# Regression 2026-07-15: frontend nginx buffered /api/codegraph until the LLM
# finished; browsers reported a network/timeout error. Status frames must arrive
# within a few seconds even when the model is slow.
info "7/7 Code Explorer SSE time-to-first-byte (expect status frame quickly)..."
CG_TMP=$(mktemp)
CG_META=$(mktemp)
if curl -skN -o "$CG_TMP" -w '%{http_code} %{time_starttransfer}' \
    --max-time 12 \
    -X POST "$APP_URL/api/codegraph/query" \
    -H 'Content-Type: application/json' \
    -d '{"question":"smoke: how does oauth login work?"}' \
    >"$CG_META" 2>/dev/null; then
  :
fi
# Exit 28 (timeout) is OK — we only need early status frames, not the full answer.
CG_CODE=$(awk '{print $1}' "$CG_META")
CG_TTFB=$(awk '{print $2}' "$CG_META")
rm -f "$CG_META"
if [ "$CG_CODE" != "200" ]; then
  fail "Code Explorer SSE HTTP $CG_CODE (expected 200) — agent/BFF path broken"
elif ! grep -q '"type": "status"' "$CG_TMP"; then
  fail "Code Explorer SSE returned 200 but no status frame — likely still buffered or agent not streaming"
elif awk "BEGIN {exit !($CG_TTFB < 5)}"; then
  pass "Code Explorer SSE TTFB ${CG_TTFB}s with status frame"
else
  fail "Code Explorer SSE TTFB ${CG_TTFB}s (>=5s) — nginx may be buffering /api/codegraph again"
fi
rm -f "$CG_TMP"

# ── verdict ───────────────────────────────────────────────────────────────────
echo ""
if [ "$FAILURES" -gt 0 ]; then
  echo -e "${RED}[SMOKE] $FAILURES check(s) FAILED — the live demo is degraded. Fix before demoing.${NC}" >&2
  exit 1
fi
echo -e "${GREEN}[SMOKE] all checks passed — live demo verified.${NC}"
