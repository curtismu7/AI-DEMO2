#!/usr/bin/env bash
# scripts/preflight-demo.sh — run ~10 minutes before a live demo.
#
# Checks, in order (red/green table, exit 0 only if ALL green):
#   1. BFF liveness           GET /api/healthz
#   2. Service health         GET /api/health/services  (all LLM-path services up,
#                             agent prompt store 'primary')
#   3. LLM backends           GET /api/demo-agent/nl/status (at least one configured)
#   4. LLM tier warm          scripts/llm-warmup.sh (loads it if cold; skip with
#                             PREFLIGHT_SKIP_WARMUP=1 — e.g. SE cluster pins the tier)
#   5. Chip replay            POST /api/demo-agent/nl per mode:'both' chip in every
#                             vertical manifest (anonymous; provider:'heuristic') —
#                             asserts each resolves to a non-none intent and, when the
#                             chip declares a tool, to that action.
#   6. Demo feature flags     gen-demo-flag-map.js --live — fails only when an AMBIENT
#                             flag is wrong (ff_use_cases_launcher, ff_heuristic_enabled).
#                             Per-step flags off is fine: they arm when the step runs.
#
#   PREFLIGHT_BASE_URL   default https://api.ping.demo:3001 (mkcert TLS → curl -k)
#
# The chip corpus is read from the repo manifests, so new verticals/chips are
# covered automatically. mode:'llm' and mode:'direct' chips are skipped by design.
set -u

BASE="${PREFLIGHT_BASE_URL:-https://api.ping.demo:3001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0
declare -a ROWS

row() { # status name detail
  ROWS+=("$1|$2|$3")
  if [[ "$1" == "OK" ]]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
}

jget() { curl -sk --max-time 5 "$1" 2>/dev/null; }

# read_lines <arrayname> <command...>  — portable stand-in for `readarray -t`
# (macOS ships bash 3.2, which lacks readarray/mapfile).
read_lines() {
  local __arr_name="$1"; shift
  local __line
  while IFS= read -r __line; do
    eval "$__arr_name+=(\"\$__line\")"
  done < <("$@")
}

# ── 1. BFF liveness ──────────────────────────────────────────────────────────
if jget "${BASE}/api/healthz" | grep -q '"status"'; then
  row OK "BFF liveness" "${BASE}/api/healthz"
else
  row FAIL "BFF liveness" "unreachable at ${BASE} — is the stack running?"
  # Without the BFF nothing else can run; print and bail.
fi

if [[ $FAIL -gt 0 ]]; then
  echo "❌ BFF unreachable at ${BASE} — start the stack (./run.sh or ./run-docker.sh) and re-run."
  exit 1
fi

# ── 2. Service health (Phase 4 aggregate) ────────────────────────────────────
SERVICES_JSON="$(jget "${BASE}/api/health/services")"
svc_rows=()
read_lines svc_rows python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("FAIL|service health|/api/health/services returned non-JSON"); raise SystemExit
svcs=d.get("services") or {}
for name in ("agent_service","mcp_server","mcp_gateway","llm_proxy","hitl_service"):
    s=svcs.get(name) or {}
    if s.get("up"):
        print(f"OK|{name}|up")
    else:
        print(f"FAIL|{name}|down: {s.get(chr(39)+"error"+chr(39), s.get("error","?")) if isinstance(s,dict) else "?"}")
prompts=(svcs.get("agent_service") or {}).get("checks",{}).get("prompts")
if prompts is None:
    print("OK|agent prompts|not reported (older agent build)")
elif prompts=="primary":
    print("OK|agent prompts|primary")
else:
    print(f"FAIL|agent prompts|degraded: {prompts} — rebuild demo_agent_service (npm run build)")
' <<< "$SERVICES_JSON"
for r in "${svc_rows[@]}"; do
  IFS='|' read -r st name detail <<< "$r"
  row "$st" "$name" "$detail"
done

# ── 3. Active LLM provider ────────────────────────────────────────────────────
NL_STATUS="$(jget "${BASE}/api/demo-agent/nl/status")"
PROVIDER_LINE="$(printf '%s' "$NL_STATUS" | python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
    p=d.get("activeLlmProvider")
    helix="helixConfigured=true" if d.get("helixConfigured") else "helixConfigured=false"
    if p:
        print(f"OK|{p} ({helix})")
    else:
        print(f"FAIL|none active (heuristics-only mode) — {helix}")
except Exception:
    print("FAIL|/nl/status returned non-JSON")')"
IFS='|' read -r st detail <<< "$PROVIDER_LINE"
row "$st" "LLM provider" "$detail"

# ── 4. LLM tier warm ─────────────────────────────────────────────────────────
if [[ "${PREFLIGHT_SKIP_WARMUP:-0}" == "1" ]]; then
  row OK "LLM tier" "warmup skipped (PREFLIGHT_SKIP_WARMUP=1)"
elif "$ROOT/scripts/llm-warmup.sh" > /tmp/preflight-warmup.log 2>&1; then
  row OK "LLM tier" "$(tail -1 /tmp/preflight-warmup.log)"
else
  row FAIL "LLM tier" "warmup failed — see /tmp/preflight-warmup.log"
fi

# ── 5. Chip replay (anonymous, heuristic provider) ───────────────────────────
# CLIENT_DISPATCHED_ACTIONS comes from the module that already owns it and is
# already test-gated. Do not retype the list here — a second copy is how the
# requiredDemoFlags mirror drifted and took 22 use cases down (#886).
CLIENT_DISPATCHED="$(node -e '
const { CLIENT_DISPATCHED_ACTIONS } = require(process.argv[1] + "/demo_api_server/scripts/useCaseSweepCauses.js");
process.stdout.write(JSON.stringify([...CLIENT_DISPATCHED_ACTIONS]));
' "$ROOT" 2>/dev/null || echo '[]')"

CHIP_RESULTS="$(BASE="$BASE" ROOT="$ROOT" CLIENT_DISPATCHED="$CLIENT_DISPATCHED" python3 - <<'PYEOF'
import json, os, glob, subprocess

base = os.environ["BASE"]
root = os.environ["ROOT"]
per_vertical = {}
failures = []
warnings = []

# Actions the BFF deliberately does NOT dispatch — dispatchBankingAction returns
# null and the UI switch handles them. Their chips are real, but this check
# replays through the API, so it does not prove those paths. Counted and
# reported rather than scored, so a green table never implies they were tested.
try:
    client_dispatched = set(json.loads(os.environ.get("CLIENT_DISPATCHED") or "[]"))
except Exception:
    client_dispatched = set()
if not client_dispatched:
    failures.append("could not load CLIENT_DISPATCHED_ACTIONS from useCaseSweepCauses.js")
client_dispatched_count = 0

# Every chip tool field must name a real tool. This is the assertion the old
# action-vs-tool comparison was groping at: it catches a typo or a tool removed
# from topology, and it is clean today (0 of 67), so a hit is a genuine defect.
try:
    _topo = json.load(open(os.path.join(root, "scope-topology.json"))).get("tools") or {}
    topology_tools = set(_topo) if isinstance(_topo, dict) else {
        t.get("name") for t in _topo if isinstance(t, dict)}
except Exception as e:
    topology_tools = set()
    failures.append(f"could not read scope-topology.json tools ({e})")

for mpath in sorted(glob.glob(os.path.join(root, "demo_api_server/config/verticals/*/manifest.json"))):
    vertical = os.path.basename(os.path.dirname(mpath))
    try:
        manifest = json.load(open(mpath))
    except Exception:
        continue
    chips = ((manifest.get("dashboard") or {}).get("chips10")) or []
    for chip in chips:
        if chip.get("mode") != "both":
            continue
        cid = chip.get("id")
        try:
            cmsg = chip["message"]
        except Exception as e:
            failures.append(f"{vertical}/{cid or '?'}: missing required field ({e})")
            pv = per_vertical.setdefault(vertical, [0, 0])
            pv[1] += 1
            continue
        body = json.dumps({"message": cmsg, "provider": "heuristic", "vertical": vertical})
        try:
            out = subprocess.run(
                ["curl", "-sk", "--max-time", "10", "-X", "POST",
                 f"{base}/api/demo-agent/nl",
                 "-H", "Content-Type: application/json", "-d", body],
                capture_output=True, text=True, timeout=15)
            resp = json.loads(out.stdout)
        except Exception as e:
            failures.append(f"{vertical}/{cid}: request failed ({e})")
            pv = per_vertical.setdefault(vertical, [0, 0])
            pv[1] += 1
            continue
        result = resp.get("result") or {}
        kind = result.get("kind")
        action = (result.get("banking") or {}).get("action") if kind == "banking" else result.get("action")
        # The kind-is-not-none check is load-bearing: it is the only signal that
        # the heuristic NL router actually recognized the chip message.
        ok = kind not in (None, "none")
        tool = chip.get("tool")
        if not ok:
            failures.append(f"{vertical}/{cid} {cmsg!r}: kind={kind}")
        if action and action in client_dispatched:
            client_dispatched_count += 1
        # NOT compared: action against tool. The heuristic router internal
        # dispatch keys (accounts, vertical_feature_demo, transfer_600_test) are a
        # deliberately distinct namespace from the manifest tool field, which
        # names the formal MCP tool used in direct/LLM modes (get_my_accounts,
        # show_permit, create_transfer). Comparing them has no true-positive
        # capability by construction, and it fired on 28 of 28 mismatches — every
        # one correct behaviour. Twenty-eight false alarms in the tool you run
        # before going on stage is how a real one gets skimmed past.
        if tool and topology_tools and tool not in topology_tools:
            failures.append(f"{vertical}/{cid}: tool {tool!r} is not in scope-topology.json")
            ok = False
        pv = per_vertical.setdefault(vertical, [0, 0])
        if ok:
            pv[0] += 1
        else:
            pv[1] += 1

print(json.dumps({"per_vertical": per_vertical, "failures": failures, "warnings": warnings,
                  "client_dispatched": client_dispatched_count}))
PYEOF
)"
chip_rows=()
read_lines chip_rows python3 -c '
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print("FAIL|chip replay total|aggregator crashed — see script output"); raise SystemExit
total_ok=0; total_fail=0
for v,(ok,fail) in sorted(d["per_vertical"].items()):
    total_ok+=ok; total_fail+=fail
    print(("OK" if fail==0 else "FAIL")+f"|chips {v}|{ok} ok, {fail} failed")
cd_n=d.get("client_dispatched",0)
suffix=f"; {cd_n} client-dispatched (UI path, not proven here)" if cd_n else ""
print(("OK" if total_fail==0 else "FAIL")+f"|chip replay total|{total_ok} ok, {total_fail} failed{suffix}")
# Print every failure/warning. The previous [:20] cap silently dropped the rest,
# which reads as "that was all of them".
for f in d["failures"]:
    print(f"FAIL|  detail|{f}")
for w in d["warnings"]:
    print(f"WARN|  detail|{w}")
' <<< "$CHIP_RESULTS"
for r in "${chip_rows[@]}"; do
  IFS='|' read -r st name detail <<< "$r"
  # detail rows are informational; only count table rows once
  if [[ "$name" == "  detail" ]]; then
    ROWS+=("$st|$name|$detail")
  else
    row "$st" "$name" "$detail"
  fi
done

# ── 6. Demo feature flags ────────────────────────────────────────────────────
# Shells out to gen-demo-flag-map.js --live rather than re-reading the flags
# here. One implementation, one set of rules about which flags matter — a second
# copy is exactly how the requiredDemoFlags mirror drifted and took 22 use cases
# down (#886).
#
# It exits non-zero ONLY for AMBIENT flags (ff_use_cases_launcher,
# ff_heuristic_enabled) — the ones nothing arms for you. Per-step flags reading
# off is expected: /api/use-cases/demo/run arms them when the step executes, so
# failing on those would cry wolf on every run.
FLAGMAP_OUT="$(node "$ROOT/scripts/gen-demo-flag-map.js" --live --base "$BASE" 2>&1)"
FLAGMAP_RC=$?
FLAG_OFF_COUNT="$(printf '%s\n' "$FLAGMAP_OUT" | grep -c 'off ff_' 2>/dev/null || true)"
if [[ "$FLAGMAP_RC" -eq 0 ]]; then
  row OK "demo flags" "ambient OK; ${FLAG_OFF_COUNT:-0} per-step flag(s) off (armed on run)"
elif [[ "$FLAGMAP_RC" -eq 1 ]]; then
  BADFLAGS="$(printf '%s\n' "$FLAGMAP_OUT" | grep '!! ' | awk '{print $3}' | paste -sd, - 2>/dev/null)"
  row FAIL "demo flags" "ambient flag(s) wrong: ${BADFLAGS:-see npm run demo:flag-map:live}"
else
  row FAIL "demo flags" "could not read flags — $(printf '%s' "$FLAGMAP_OUT" | tail -1 | cut -c1-70)"
fi

# ── 7. Deep pipeline replay (optional: --deep) ───────────────────────────────
# Reuses the existing real-test machinery: scripts/run-real-tests.sh loads
# PingOne creds from demo_api_server/.env, logs in headlessly, and replays every
# `both` chip through the FULL authenticated RFC 8693 pipeline
# (tests/real/shared/all-chips-pipeline.test.js). Skips cleanly without creds.
if [[ "${1:-}" == "--deep" ]]; then
  echo "[preflight] --deep: running authenticated pipeline replay (this logs in as the demo user)..."
  if "$ROOT/scripts/run-real-tests.sh" shared > /tmp/preflight-deep.log 2>&1; then
    row OK "deep pipeline" "$(grep -Eo 'Tests:.*' /tmp/preflight-deep.log | tail -1)"
  else
    row FAIL "deep pipeline" "failed — see /tmp/preflight-deep.log"
  fi
fi

# ── Table + verdict ───────────────────────────────────────────────────────────
echo
printf '%s\n' "── Demo preflight: ${BASE} ──────────────────────────────"
for r in "${ROWS[@]}"; do
  IFS='|' read -r st name detail <<< "$r"
  case "$st" in
    OK)   icon="✅" ;;
    WARN) icon="⚠️" ;;
    *)    icon="❌" ;;
  esac
  printf '%s %-24s %s\n' "$icon" "$name" "$detail"
done
echo
# Fallback ladder readiness — which layer are you walking into if something dies?
echo "— fallback ladder —"
node scripts/check-goldens.js 2>/dev/null | head -1 || echo "  (goldens check unavailable)"
echo "  L1 heuristics: always available (mode switch)"
echo "  L2 simulated authorize: PATCH ff_authorize_simulated=true (+ authz-server)"
echo "  L3 REPLAY: button on any chip-failure message (needs goldens above)"
echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ ALL CHECKS PASSED (${PASS}) — you're good to demo."
  exit 0
else
  echo "❌ ${FAIL} CHECK(S) FAILED — fix before showtime."
  exit 1
fi
