# Demo Hardening Phase 3 — Prompt Consolidation + Preflight Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One source of truth for the conversational system prompt, a regression test locking the prompt-assembly ordering that already caused theme-override bugs, a build-time gate on the agent-service prompt copy, and `scripts/preflight-demo.sh` — a red/green pre-show check a presenter runs ~10 minutes before a live demo.

**Architecture:** The five duplicated "knowledgeable assistant" prompts in `geminiNlIntent.js` collapse into one exported helper (also fixing the Helix site, which ignores the active vertical today). The assembly-ordering contract (base → theme → neutral role note appended last) gets a test that fails if anyone reintroduces domain-specific wording in the role note. The agent-service `build` script gains a verify step so a dropped `copy:assets` fails the build instead of silently shipping without guardrails. The preflight script needs NO auth: `POST /api/demo-agent/nl` allows anonymous calls, so it replays every `mode:'both'` chip from the vertical manifests with `provider:'heuristic'`, asserts each resolves to its expected action, checks all health surfaces (Phase 4's `/api/health/services` incl. `checks.prompts`), and warms the LLM tier via Phase 2's `scripts/llm-warmup.sh`.

**Tech Stack:** Node.js CommonJS + jest (demo_api_server), TypeScript scripts (demo_agent_service package.json only), bash + python3 + curl (scripts/).

**Spec:** `docs/superpowers/specs/2026-07-11-demo-hardening-design.md` (Phase 3 section).

**Verified current-state facts this plan is built on:**
- Inline prompts: 5 sites in `demo_api_server/services/geminiNlIntent.js` — `:79` (answerWithHelix, hardcodes "banking demo platform", ignores active vertical), `:170` (Claude), `:191` (LM Studio), `:229` (llama.cpp), `:251` (mlx). Sites 170-251 all compute `const domain = (typeof context.vertical === 'string' && context.vertical) ? context.vertical.replace(/-/g, ' ') : 'banking';` and interpolate the same sentence. answerWithGoogle reuses `buildSystemWithCtx` — NOT part of this consolidation.
- Assembly: `buildSystemWithCtx` (`geminiNlIntent.js:33-45`) appends a role note AFTER the theme; the ordering-fragility comment (`:34-40`) documents the past bug ("the LLM weighs later instructions more heavily, so the role note was undoing the theme") and the mitigation: the role note must stay vertical-neutral. Exact strings: admin → `'This user has admin privileges and can query data across all users.'`; else → `'This is a regular signed-in user — queries apply to their own data only.'`. Exported via `__test` alongside `buildSystem`.
- NL endpoint: `POST /api/demo-agent/nl` (`routes/demoAgentNl.js:102-137`) — **anonymous allowed** (mounted BEFORE the authenticated agent routes at `server.js:1033`, no auth middleware; `refreshIfExpiring` passes anonymous requests through). Body `{message (required), provider (default 'auto'; 'heuristic' forces heuristic-only), vertical ([a-z][a-z0-9-]*)}`; 200 → `{source, result, llm_attempted, llm_not_configured}`; `guardPromptInput` passes benign chip phrases. `GET /api/demo-agent/nl/status` (`:139+`, unauthenticated) → `{ activeLlmProvider, helixConfigured, heuristicAlwaysAvailable }` — `activeLlmProvider === null` means heuristics-only mode.
- Deep-pipeline machinery already exists: `scripts/run-real-tests.sh` loads creds from `demo_api_server/.env`, health-gates on the live BFF, sets `RUN_REAL_TESTS=true`, and runs `tests/real/` suites — `tests/real/shared/all-chips-pipeline.test.js` replays every `both` chip through the FULL authenticated RFC 8693 pipeline (headless PingOne login via `tests/real/helpers/session.js`; skips cleanly without creds). The preflight's `--deep` mode reuses this instead of reimplementing auth (user-approved: forcing a login for preflight is acceptable).
- Health surfaces (post-Phase-4, all unauthenticated): `GET /api/healthz` (trivial), `GET /api/health/services` (probes mcp_gateway/mcp_server/hitl_service/agent_service[+checks.prompts]/llm_proxy, always 200), llm-proxy `:8090/health` (`{status, mode, models:[{name,port,size,healthy,load}]}`), agent-service `:3006/health` (`checks.prompts: 'primary'|'src_fallback'|'inline_fallback'`).
- Warmup: `scripts/llm-warmup.sh` (Phase 2) exits 0 when the target tier is healthy/serving — fast no-op if warm, loads if cold (up to `LLM_WARMUP_TIMEOUT_S`, default 240).
- Chips: `demo_api_server/config/verticals/<id>/manifest.json` → `dashboard.chips10` `{id,label,message,mode,tool}`; the 12 chips10 verticals are admin, banking, government, healthcare, investment, manufacturing, oauth-teaching, pingone-admin, retail, sporting-goods, university, workforce; `mode:'llm'`/`'direct'` chips do not route via heuristics by design.
- agent-service build: `"build": "tsc && npm run copy:assets"`, `"copy:assets": "cp -R src/prompts dist/prompts"` — NOTHING verifies the copy today; Dockerfile runs `npm run build`. Phase 4 added runtime self-mend + `checks.prompts`; the missing piece is a build-time failure.
- No preflight/smoke script exists today (verified). The live `tests/real/` chip suite needs Playwright + PingOne creds — unsuitable for unattended preflight; its /nl assertions are reproducible anonymously.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️` `✅` `❌` `🔐` `✕` `✓` in code/UI/scripts (the preflight table uses `✅`/`❌` — allowed).
- Minimal diff; no new npm dependencies; no OAuth/permission scope changes.
- Jest from `demo_api_server/`; in this `.claude/worktrees/` checkout EVERY jest run must append `--testPathIgnorePatterns='/node_modules/'` (0 matches is NOT a pass). BFF test files only under `src/__tests__/` or `tests/` (jest testMatch collects only those roots).
- `tryParseIntentJson`, `JSON_RETRY_NUDGE`, `INTENT_JSON_SCHEMA`, the breaker wiring, and the provider branches in `geminiNlIntent.js` are NOT touched by this phase — only the five conversational prompt strings and (test-only) the assembly contract.
- Do not modify `buildSystemWithCtx`'s behavior — Task 2 LOCKS it with a test; it does not change it.
- Stage explicitly (`git add <files>`, never `-A`); verify `git branch --show-current` = plan/demo-hardening-phase3; leave `demo_api_server/data/persistent/*` artifacts unstaged.
- `bash -n` must pass on any edited/created shell script.

---

### Task 1: Consolidate the conversational system prompt

**Files:**
- Modify: `demo_api_server/services/geminiNlIntent.js` (add one helper near the top; replace the 5 inline strings)
- Test: `demo_api_server/src/__tests__/conversationalPrompt.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `conversationalSystemPrompt(context = {}) => string`, exported via the existing `__test` export object. One sentence, single source of truth: `` `You are a knowledgeable assistant for a ${domain} platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.` `` where `domain` = `context.vertical.replace(/-/g, ' ')` when `context.vertical` is a non-empty string, else `'banking'`.

**Deliberate behavior change (spec-sanctioned consolidation):** the Helix site (`answerWithHelix`) currently hardcodes `"banking demo platform"` and ignores the active vertical — after this task it uses the same helper as its four siblings, so a healthcare-vertical conversational answer via Helix says "healthcare platform" like every other provider. This is the bug the duplication caused; name it in the commit body.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/conversationalPrompt.test.js
'use strict';

/**
 * Phase 3: ONE source of truth for the conversational system prompt.
 * Five provider paths previously duplicated this string inline; the Helix
 * copy had drifted (hardcoded "banking demo platform", ignored the vertical).
 */

const { __test } = require('../../services/geminiNlIntent');

describe('conversationalSystemPrompt', () => {
  it('is exported for reuse', () => {
    expect(typeof __test.conversationalSystemPrompt).toBe('function');
  });

  it('defaults to banking', () => {
    expect(__test.conversationalSystemPrompt({})).toBe(
      "You are a knowledgeable assistant for a banking platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.",
    );
  });

  it('uses the active vertical with dashes humanized', () => {
    expect(__test.conversationalSystemPrompt({ vertical: 'sporting-goods' }))
      .toContain('for a sporting goods platform');
  });

  it('ignores non-string vertical values', () => {
    expect(__test.conversationalSystemPrompt({ vertical: 42 })).toContain('for a banking platform');
    expect(__test.conversationalSystemPrompt({ vertical: '' })).toContain('for a banking platform');
  });

  it('is the ONLY definition — no inline duplicates remain in the module source', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/geminiNlIntent.js'), 'utf8');
    const matches = src.match(/knowledgeable assistant/g) || [];
    expect(matches).toHaveLength(1); // the helper itself
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=conversationalPrompt --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `conversationalSystemPrompt` is not a function, and the source currently contains 5 occurrences.

- [ ] **Step 3: Implement**

Add near the top of `geminiNlIntent.js` (after the `buildSystemWithCtx` function is a good spot):

```js
/**
 * Single source of truth for the conversational (non-router) system prompt.
 * Previously duplicated inline at five provider sites; the Helix copy had
 * drifted to a hardcoded "banking demo platform" that ignored the active
 * vertical. Google is intentionally NOT on this helper — it reuses the full
 * buildSystemWithCtx router context.
 */
function conversationalSystemPrompt(context = {}) {
  const domain = (typeof context.vertical === 'string' && context.vertical)
    ? context.vertical.replace(/-/g, ' ')
    : 'banking';
  return `You are a knowledgeable assistant for a ${domain} platform. Answer the user's question concisely and accurately. Keep your answer to 1-2 paragraphs.`;
}
```

Then replace each of the five inline strings:

1. `answerWithHelix` (the `messages` system content at ~:79): replace the whole hardcoded string with `conversationalSystemPrompt(context)` (the function already receives `context = {}`).
2. `answerWithClaude` (~:170): replace the template literal with `conversationalSystemPrompt(context)` AND delete that function's now-unused local `const domain = ...` lines.
3. `answerWithLmStudio` (~:191): same replacement; delete the local `domain` computation.
4. `answerWithLlamaCpp` (~:229): same.
5. `answerWithMlx` (~:251): same.

Add `conversationalSystemPrompt` to the `__test` export object at the bottom of the file (alongside `buildSystem, buildSystemWithCtx, ...`).

- [ ] **Step 4: Run the suites**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' --testPathPattern='conversationalPrompt|geminiNlIntent|tryParseIntentJson'`
Expected: PASS — all pre-existing geminiNlIntent suites unaffected (they exercise routing, not conversational prompt text; if one asserts the old Helix "banking demo platform" string, that assertion is locking the drift bug — update it to the helper's output and note it in your report).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/geminiNlIntent.js demo_api_server/src/__tests__/conversationalPrompt.test.js
git commit -m "refactor(nl-intent): one conversational system prompt; Helix now respects the active vertical"
```

---

### Task 2: Lock the prompt-assembly ordering contract (test-only)

**Files:**
- Test: `demo_api_server/src/__tests__/promptAssembly.contract.test.js`

**Interfaces:**
- Consumes: `__test.buildSystem`, `__test.buildSystemWithCtx` from `services/geminiNlIntent.js` (existing exports; NOT modified).
- Produces: a standing regression test encoding the documented ordering bug: the theme override must come after the base rules, the role note (appended last, weighted most by the LLM) must remain vertical-neutral — the exact neutral strings are locked, and any reintroduction of domain-specific wording ("account", "banking", "transfer") in the role note fails by name.

- [ ] **Step 1: Write the test (it should PASS immediately — it locks current correct behavior; verify it fails if broken via the mutation check in Step 3)**

```js
// demo_api_server/src/__tests__/promptAssembly.contract.test.js
'use strict';

/**
 * Phase 3: assembly-ordering contract for the NL router system prompt.
 *
 * Documented bug (geminiNlIntent.js buildSystemWithCtx comment): the role
 * note is appended AFTER the theme override, and "the LLM weighs later
 * instructions more heavily" — a role note carrying banking terminology
 * silently undid themes that instruct "never surface banking terminology".
 * The fix was vertical-NEUTRAL role wording. This suite locks that contract:
 * ordering (base -> theme -> role note last) and role-note neutrality.
 */

const path = require('node:path');
const { __test } = require('../../services/geminiNlIntent');

const { base: SYSTEM_BASE, themes: THEME_OVERRIDES } =
  require(path.join(__dirname, '../../../docs/HELIX_AGENT_DIRECTIVES.json'));

const ADMIN_NOTE = 'This user has admin privileges and can query data across all users.';
const USER_NOTE = 'This is a regular signed-in user — queries apply to their own data only.';

describe('prompt assembly ordering contract', () => {
  it('base rules come first, theme override after, for every themed vertical', () => {
    for (const vertical of Object.keys(THEME_OVERRIDES)) {
      const sys = __test.buildSystem(vertical);
      expect(sys.startsWith(SYSTEM_BASE)).toBe(true);
      expect(sys.indexOf(THEME_OVERRIDES[vertical])).toBeGreaterThanOrEqual(SYSTEM_BASE.length);
    }
  });

  it('role note is appended LAST, after the theme content', () => {
    const vertical = Object.keys(THEME_OVERRIDES)[0];
    const sys = __test.buildSystemWithCtx(vertical, { role: 'admin', firstName: 'Ada' });
    const noteIdx = sys.indexOf(ADMIN_NOTE);
    expect(noteIdx).toBeGreaterThan(-1);
    expect(noteIdx).toBeGreaterThan(sys.indexOf(THEME_OVERRIDES[vertical]));
    expect(sys.endsWith(ADMIN_NOTE)).toBe(true);
  });

  it('role notes are the locked vertical-neutral strings (the anti-override fix)', () => {
    const adminSys = __test.buildSystemWithCtx('healthcare', { role: 'admin' });
    const userSys = __test.buildSystemWithCtx('healthcare', { role: 'user' });
    expect(adminSys.endsWith(ADMIN_NOTE)).toBe(true);
    expect(userSys.endsWith(USER_NOTE)).toBe(true);
  });

  it('the appended role context never contains banking terminology (would override themes)', () => {
    for (const vertical of Object.keys(THEME_OVERRIDES)) {
      const sys = __test.buildSystemWithCtx(vertical, { role: 'admin', firstName: 'Ada' });
      const appended = sys.slice(__test.buildSystem(vertical).length);
      expect(appended).not.toMatch(/\b(bank|banking|account|accounts|transfer|balance)\b/i);
    }
  });

  it('no role in context leaves the system prompt untouched', () => {
    const vertical = Object.keys(THEME_OVERRIDES)[0];
    expect(__test.buildSystemWithCtx(vertical, {})).toBe(__test.buildSystem(vertical));
  });
});
```

- [ ] **Step 2: Run it — expect PASS (locks current behavior)**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=promptAssembly --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (5 tests). If any test FAILS, current behavior has drifted from the documented contract — STOP and report DONE_WITH_CONCERNS with the failing detail; do not adjust the test to match drifted behavior without escalating.

- [ ] **Step 3: Mutation check (proves the test bites — do not commit this mutation)**

Temporarily change the admin roleNote string in `buildSystemWithCtx` to `'Admin users can query ALL accounts.'` (the historical buggy wording), re-run the suite, confirm the neutrality test FAILS, then `git checkout -- demo_api_server/services/geminiNlIntent.js` to revert. Record the failing output in your report as evidence the contract bites.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/src/__tests__/promptAssembly.contract.test.js
git commit -m "test(nl-intent): lock prompt-assembly ordering and role-note neutrality contract"
```

---

### Task 3: Build-time gate on the agent-service prompt copy

**Files:**
- Modify: `demo_agent_service/package.json` (scripts only)

**Interfaces:**
- Consumes: the existing `build` chain (`tsc && npm run copy:assets`).
- Produces: `"verify:prompts"` script; `build` becomes `tsc && npm run copy:assets && npm run verify:prompts` — a build that fails to place `dist/prompts/default.json` now EXITS NON-ZERO instead of shipping an agent without its curated guardrails. (Runtime self-mend from Phase 4 remains the backstop; this catches it at build time, including in the Dockerfile which runs `npm run build`.)

- [ ] **Step 1: Edit package.json scripts**

Change:

```json
    "build": "tsc && npm run copy:assets",
    "copy:assets": "cp -R src/prompts dist/prompts",
```

to:

```json
    "build": "tsc && npm run copy:assets && npm run verify:prompts",
    "copy:assets": "cp -R src/prompts dist/prompts",
    "verify:prompts": "node -e \"require('fs').accessSync('dist/prompts/default.json'); console.log('[build] dist/prompts verified')\"",
```

- [ ] **Step 2: Verify both directions**

```bash
cd demo_agent_service && npm run build 2>&1 | tail -2          # expect: "[build] dist/prompts verified"
rm -rf dist/prompts && npm run verify:prompts; echo "exit=$?"   # expect: non-zero exit (ENOENT)
npm run copy:assets && npm run verify:prompts                    # restore + expect verified again
```

Expected: build green with the verified line; the middle command exits non-zero proving the gate bites; restored after.

- [ ] **Step 3: Run the agent-service suite (unchanged behavior)**

Run: `cd demo_agent_service && npx jest --forceExit --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (no runtime code changed).

- [ ] **Step 4: Commit**

```bash
git add demo_agent_service/package.json
git commit -m "build(agent): fail the build when dist/prompts is missing"
```

---

### Task 4: `scripts/preflight-demo.sh` — the pre-show red/green check

**Files:**
- Create: `scripts/preflight-demo.sh` (repo root scripts/, executable)

**Interfaces:**
- Consumes: `GET {BASE}/api/healthz`, `GET {BASE}/api/health/services` (Phase 4 aggregate incl. `agent_service.checks.prompts`), `GET {BASE}/api/demo-agent/nl/status`, `POST {BASE}/api/demo-agent/nl` (anonymous), `scripts/llm-warmup.sh` (Phase 2, exit 0 = tier warm), and every `demo_api_server/config/verticals/*/manifest.json` chips10 entry with `mode:'both'`.
- Produces: a presenter-facing script: red/green table per check, per-vertical chip-replay counts, exit 0 only when everything passed. Env knobs: `PREFLIGHT_BASE_URL` (default `https://api.ping.demo:3001`, curl `-k` for the mkcert cert), `PREFLIGHT_SKIP_WARMUP=1` (skip the tier warmup, e.g. on the SE cluster where the pinned tier boot-loads). Flag: `--deep` additionally runs `scripts/run-real-tests.sh` (existing machinery: loads creds from `demo_api_server/.env`, performs the headless PingOne login itself, replays every `both` chip through the FULL authenticated RFC 8693 pipeline via `tests/real/shared/all-chips-pipeline.test.js`). Deep mode requires login creds in `.env` — user-approved; the fast default stays anonymous.

- [ ] **Step 1: Write the script**

```bash
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
readarray -t svc_rows < <(printf '%s' "$SERVICES_JSON" | python3 -c '
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
')
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
CHIP_RESULTS="$(BASE="$BASE" ROOT="$ROOT" python3 - <<'PYEOF'
import json, os, glob, subprocess

base = os.environ["BASE"]
root = os.environ["ROOT"]
per_vertical = {}
failures = []

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
        body = json.dumps({"message": chip["message"], "provider": "heuristic", "vertical": vertical})
        try:
            out = subprocess.run(
                ["curl", "-sk", "--max-time", "10", "-X", "POST",
                 f"{base}/api/demo-agent/nl",
                 "-H", "Content-Type: application/json", "-d", body],
                capture_output=True, text=True, timeout=15)
            resp = json.loads(out.stdout)
        except Exception as e:
            failures.append(f"{vertical}/{chip.get('id')}: request failed ({e})")
            per_vertical.setdefault(vertical, [0, 0])[1] += 1
            continue
        result = resp.get("result") or {}
        kind = result.get("kind")
        action = (result.get("banking") or {}).get("action") if kind == "banking" else result.get("action")
        ok = kind not in (None, "none")
        tool = chip.get("tool")
        if ok and tool and action and action != tool:
            # Action mismatch is a warning-grade failure: the chip resolved, but not
            # to its declared tool. Education-kind results have no action — skip.
            if kind in ("banking", "vertical"):
                ok = False
                failures.append(f"{vertical}/{chip.get('id')} \"{chip['message']}\": routed to {action}, manifest says {tool}")
        elif not ok:
            failures.append(f"{vertical}/{chip.get('id')} \"{chip['message']}\": kind={kind}")
        pv = per_vertical.setdefault(vertical, [0, 0])
        pv[0 if ok else 1] += 1 if ok else 0
        if not ok:
            pv[1] += 1
        else:
            pass

print(json.dumps({"per_vertical": per_vertical, "failures": failures}))
PYEOF
)"
readarray -t chip_rows < <(printf '%s' "$CHIP_RESULTS" | python3 -c '
import json,sys
d=json.load(sys.stdin)
total_ok=0; total_fail=0
for v,(ok,fail) in sorted(d["per_vertical"].items()):
    total_ok+=ok; total_fail+=fail
    print(("OK" if fail==0 else "FAIL")+f"|chips {v}|{ok} ok, {fail} failed")
print(("OK" if total_fail==0 else "FAIL")+f"|chip replay total|{total_ok} ok, {total_fail} failed")
for f in d["failures"][:20]:
    print(f"FAIL|  detail|{f}")
')
for r in "${chip_rows[@]}"; do
  IFS='|' read -r st name detail <<< "$r"
  # detail rows are informational; only count table rows once
  if [[ "$name" == "  detail" ]]; then
    ROWS+=("$st|$name|$detail")
  else
    row "$st" "$name" "$detail"
  fi
done

# ── 6. Deep pipeline replay (optional: --deep) ───────────────────────────────
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
  if [[ "$st" == "OK" ]]; then icon="✅"; else icon="❌"; fi
  printf '%s %-24s %s\n' "$icon" "$name" "$detail"
done
echo
if [[ $FAIL -eq 0 ]]; then
  echo "✅ ALL CHECKS PASSED (${PASS}) — you're good to demo."
  exit 0
else
  echo "❌ ${FAIL} CHECK(S) FAILED — fix before showtime."
  exit 1
fi
```

Make it executable: `chmod +x scripts/preflight-demo.sh`.

Implementer notes:
- The per-vertical counting block above has a known clumsy spot (the `pv[0 if ok else 1] += 1 if ok else 0` line followed by the explicit `pv[1] += 1`) — REWRITE that small accounting section cleanly while implementing: `pv = per_vertical.setdefault(vertical, [0, 0])` then `pv[0] += 1` if ok else `pv[1] += 1`, once. Everything else (endpoints, body shape, assertions, table format, exit semantics) is the contract.
- macOS ships bash 3.2 which lacks `readarray` — check `bash --version` on this machine; if 3.2, replace both `readarray -t X < <(...)` uses with a `while IFS= read -r line` loop appending to the array. `run.sh` in this repo is the style guide for portable bash.
- `--deep` invocation: verify `scripts/run-real-tests.sh`'s actual CLI first (read its arg handling) — if it doesn't accept a suite argument like `shared`, invoke the underlying npm script directly instead: `(cd "$ROOT/demo_api_server" && npm run test:real:shared)` with the same log redirection. The contract is "run the shared real suite, OK on exit 0"; the exact invocation follows the script's real interface.
- Action-vs-tool mismatch: some chips legitimately resolve to an education intent or a differently-named internal action. If the LIVE run (Step 2) shows mismatch failures for chips that demonstrably work in the UI, downgrade the mismatch check to a WARN row (yellow is out — use `⚠️` prefix inside the detail text, keep the row OK) and note each in your report — do NOT delete the non-none assertion, which is the load-bearing check.

- [ ] **Step 2: Verify**

```bash
bash -n scripts/preflight-demo.sh && echo syntax-ok
# Live run (only if the local stack is up — check first):
curl -sk --max-time 2 "${PREFLIGHT_BASE_URL:-https://api.ping.demo:3001}/api/healthz" >/dev/null && ./scripts/preflight-demo.sh; echo "exit=$?"
```

Expected: `syntax-ok`; if the stack is up, a full red/green table (chip replay counts per vertical) and exit 0 — or named failures to investigate. If the stack is down, note "stack down — syntax + review only" in the report; the script MUST still be reviewed against the endpoint contracts above.

- [ ] **Step 3: Commit**

```bash
git add scripts/preflight-demo.sh
git commit -m "feat(demo): preflight-demo.sh — pre-show red/green check (health, warmup, chip replay)"
```

---

### Task 5: Verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full BFF suite**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/|/tests/real/'`
Expected: no NEW failures vs baseline (known noise: envReconcile / pingoneTestRoutes PingOne-connectivity, parallel-run flakes that pass in isolation — classify every failure by name against `git diff --name-only $(git merge-base main HEAD)..HEAD`).

- [ ] **Step 2: Agent-service suite + build gate**

Run: `cd demo_agent_service && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' && npm run build 2>&1 | tail -1`
Expected: suite PASS; build ends with `[build] dist/prompts verified`.

- [ ] **Step 3: Script syntax**

Run: `bash -n scripts/preflight-demo.sh && bash -n scripts/llm-warmup.sh && bash -n run.sh && echo ok`
Expected: `ok`.

- [ ] **Step 4: Record results**

Report: pass/fail counts per gate, every failure named + classified, the live preflight run outcome (or stack-down note), and whether any chip-replay mismatches were downgraded to warnings (list them).
