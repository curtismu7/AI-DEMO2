# NeMo Guardrails PromptGuard UI Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a UI-configurable demo rule and a choice between the existing PromptGuard classifier and optional NeMo Guardrails while preserving Privilege's `/inspect` contract.

**Architecture:** Keep the built-in Hugging Face classifier as the default sidecar detector and add NeMo as an optional in-process detector using the same ProtectAI checkpoint. Add loopback-only config endpoints consumed directly by a small LLM Gateway control panel, and integrate the already-authorized LaunchAgent port-forward scripts into this branch.

**Tech Stack:** Python 3.12, `transformers==4.44.2`, `torch==2.4.1`, optional `nemoguardrails==0.24.1`, Python `http.server`, React 19.2, Vite 8, Vitest 3.2, Docker, macOS LaunchAgent, `kubectl port-forward`.

**Spec:** [2026-09-29-nemoguardrails-promptguard-ui-config-design.md](../specs/2026-09-29-nemoguardrails-promptguard-ui-config-design.md)

## Global Constraints

- Work only in the isolated worktree `/Users/cmuir/Development/AI-DEMO2/.worktrees/promptguard-demo-config` on branch `feat/promptguard-demo-config`; stage only the files listed in the task being committed.
- Do not run `docker compose` from the worktree; use `npm run serve:worktree here` only if the shared UI stack must serve worktree code.
- Node.js services require Node `>=22`; run `npm ci` inside `demo_api_ui/` before UI checks if that worktree has no installed dependencies.
- The sidecar listens on port `8086`; Privilege's `POST /inspect` JSON request and `{"findings": [...]}` response contract stays unchanged.
- The built-in classifier is the default and works with the existing base requirements; NeMo is optional and enabled for a Docker build with `PROMPTGUARD_INSTALL_NEMO=1` (default `0`).
- Both engines use `protectai/deberta-v3-base-prompt-injection-v2`, threshold `0.9`, and `SAFE` as a benign label.
- The control URL is `http://localhost:8086`; the only allowed browser origin is `https://local.ping-devops.com:4000`.
- The demo override defaults to disabled, is process-global, and matches a case-insensitive literal substring only on request-direction user-prompt units.
- Keep the control port loopback-only. Do not deploy or push the sidecar image to a remote cluster or owner.
- UI code is JavaScript/JSX, uses Vitest rather than Jest, follows theme tokens, and uses only the repository emoji allowlist.
- Before changing UI code, read `REGRESSION_PLAN.md` §0–§1 and invoke `.claude/skills/regression-guard/SKILL.md`; preserve auth, BFF, route, and emoji invariants.
- UI verification uses `cd demo_api_ui && npm run test:unit` and `cd demo_api_ui && npm run build`; run the stylesheet contrast audit in light and dark themes if the page stylesheet changes.

## File Structure

- `demo_mcp_promptguard/detectors.py` — detector result shape, built-in and NeMo implementations, lazy optional dependency loading, and serialized engine selection.
- `demo_mcp_promptguard/nemo_config/config.yml` — NeMo input rail configuration for the existing ProtectAI checkpoint.
- `demo_mcp_promptguard/requirements-nemo.txt` — pinned optional NeMo dependency; leave the current base `requirements.txt` usable without NeMo.
- `demo_mcp_promptguard/server.py` — Privilege adapter, demo configuration state, `/demo/config` control API, CORS/origin checks, and `/inspect` mapping.
- `demo_mcp_promptguard/test_server.py` — standard-library tests using fake detector results and a local ephemeral HTTP server; no model download is needed for this suite.
- `demo_mcp_promptguard/Dockerfile` and `README.md` — optional dependency build switch and operator build/control instructions.
- `demo_api_ui/src/pages/PromptGuardControlPanel.jsx` — isolated UI control panel that talks directly to the loopback sidecar without BFF credentials.
- `demo_api_ui/src/pages/__tests__/PromptGuardControlPanel.test.jsx` — focused Vitest coverage for connection, engine selection, draft persistence, and Apply behavior.
- `demo_api_ui/src/pages/LlmGatewayPage.jsx` — mount the control panel below the at-a-glance reel band.
- `demo_api_ui/src/pages/LlmGatewayPage.css` — theme-token styles for the control panel.
- `scripts/promptguard-port-forward.sh`, `scripts/install-promptguard-port-forward-launchd.sh`, `scripts/test-promptguard-port-forward-launchd.sh` — reuse the already-authorized LaunchAgent implementation from commit `60cfd0c37`.

## Interfaces

The sidecar detector manager exposes:

- `DetectorManager.engines() -> list[dict]`, returning `{"id": str, "available": bool, "reason": str | None}` entries.
- `DetectorManager.active_engine() -> str`, returning `classifier` or `nemo`.
- `DetectorManager.select_engine(engine: str) -> None`, raising `DetectorUnavailable` if the target cannot be activated and preserving the prior active engine.
- `DetectorManager.check(text: str) -> dict`, returning `{"blocked": bool, "label": str | None, "score": float | None}`.
- `DetectorManager(model, threshold, benign_labels, nemo_config_dir, detector_factories=None)`, with `detector_factories` available for dependency-free tests.
- `server.to_findings(units, detector_manager, demo_config) -> list[dict]`, applying the demo rule first and otherwise calling `detector_manager.check(text)` once for each non-empty unit.

When a detector returns `blocked: true` without a score (the NeMo rail's normal check result), map it to high severity. Preserve the current score-based severity mapping when a score is available.

The control config is:

```json
{
  "engine": "classifier",
  "demo": {
    "enabled": false,
    "triggerPhrase": "",
    "outcome": "block"
  }
}
```

`GET /demo/config` returns `{ "config": <control config>, "engines": <engine entries> }`. `PUT /demo/config` accepts the control config and returns the same shape after applying it. An empty trigger phrase is valid only while `demo.enabled` is false. A phrase is required while enabled and is limited to 120 characters. The JSON body limit is 4096 bytes.

The UI panel uses `fetch()` directly for `http://localhost:8086` with `mode: 'cors'` and `credentials: 'omit'`. It persists the last-applied sidecar config under localStorage key `promptguard-sidecar-config-draft`; it never applies that draft automatically on load.

---

### Task 1: Integrate the login port-forward supervisor

**Files:**
- Create from existing commit `60cfd0c37`: `scripts/promptguard-port-forward.sh`
- Create from existing commit `60cfd0c37`: `scripts/install-promptguard-port-forward-launchd.sh`
- Create from existing commit `60cfd0c37`: `scripts/test-promptguard-port-forward-launchd.sh`

**Interfaces:**
- Produces a loopback port-forward at `localhost:8086`, supervised after login and retried when the target pod or connection changes.
- Installer targets the stable main-checkout script path so the LaunchAgent does not point into a disposable worktree.

- [ ] **Step 1: Bring the previously authorized port-forward commit into this branch**

```bash
git cherry-pick 60cfd0c37
```

Expected: the three script files are added as one commit on `feat/promptguard-demo-config`.

- [ ] **Step 2: Run the supervisor and installer script checks**

Run from the repository root:

```bash
bash scripts/test-promptguard-port-forward-launchd.sh
```

Expected: `PromptGuard port-forward LaunchAgent tests passed`.

---

### Task 2: Add interchangeable detector runtimes

**Files:**
- Create: `demo_mcp_promptguard/detectors.py`
- Create: `demo_mcp_promptguard/nemo_config/config.yml`
- Create: `demo_mcp_promptguard/requirements-nemo.txt`
- Modify: `demo_mcp_promptguard/test_server.py`

**Interfaces:**
- `DetectorManager(model, threshold, benign_labels, nemo_config_dir)` implements the interface above.
- `ClassifierDetector.check(text)` wraps the current Transformers pipeline and returns the normalized detector result.
- `NeMoDetector.check(text)` runs NeMo `IORails.check_async()` through a managed async runtime and returns the same normalized result.
- The built-in detector is always listed as available when its existing base runtime initialized. NeMo is reported unavailable with a stable reason when the package is missing. If lazy initialization fails during selection, the manager records the failure reason, retains the prior engine, and reports NeMo unavailable on the next `engines()` call.
- Engine switching is serialized with checks. The manager closes the previous runtime before activating the selected one; failed activation restores the previous engine and reports the switch as failed.

- [ ] **Step 1: Add focused tests for manager capabilities and result normalization**

Add tests to `test_server.py` using fake detector factories. Include cases for: built-in available without NeMo, NeMo unavailable without importing it, a fake NeMo block result, a safe result, successful selection, unavailable selection leaving the built-in active, failed selection restoring the previous engine, and the failed NeMo engine being reported unavailable afterward. Use a fake factory interface so no Transformers or NeMo model loads:

Use this normalized result fixture in the tests:

```python
BLOCKED = {"blocked": True, "label": "INJECTION", "score": 0.97}
ALLOWED = {"blocked": False, "label": "SAFE", "score": 0.99}

class FakeDetector:
    def __init__(self, result):
        self.result = result

    def check(self, text):
        return self.result

def test_manager_selects_the_requested_engine():
    manager = DetectorManager(
        model="test-model",
        threshold=0.9,
        benign_labels={"safe"},
        nemo_config_dir="nemo_config",
        detector_factories={
            "classifier": lambda: FakeDetector(ALLOWED),
            "nemo": lambda: FakeDetector(BLOCKED),
        },
    )
    assert manager.check("sample") == ALLOWED
    manager.select_engine("nemo")
    assert manager.check("sample") == BLOCKED
```

- [ ] **Step 2: Run the sidecar checks and confirm the new manager tests fail first**

```bash
cd demo_mcp_promptguard && python3 test_server.py
```

Expected: the new detector-manager tests fail because `DetectorManager` and `DetectorUnavailable` are not implemented yet.

- [ ] **Step 3: Implement the detector manager and optional NeMo rail**

Add `DetectorManager`, `DetectorUnavailable`, and the two detector drivers to `detectors.py`. Import `nemoguardrails` lazily inside the NeMo driver so importing and running the built-in path does not require the optional package. Keep only the selected runtime active. Configure NeMo's HF Classifier input rail to use the same model, threshold, and benign label as the built-in runtime. Pin `nemoguardrails==0.24.1` in `requirements-nemo.txt`.

- [ ] **Step 4: Re-run the sidecar checks**

```bash
cd demo_mcp_promptguard && python3 test_server.py
```

Expected: `ok` and exit code 0, with both detector engines covered through fakes and no model download.

- [ ] **Step 5: Commit the detector runtime**

```bash
git add demo_mcp_promptguard/detectors.py demo_mcp_promptguard/nemo_config/config.yml demo_mcp_promptguard/requirements-nemo.txt demo_mcp_promptguard/test_server.py
git commit -m "feat: add optional NeMo PromptGuard detector"
```

---

### Task 3: Add the demo config API and deterministic findings

**Files:**
- Modify: `demo_mcp_promptguard/server.py`
- Modify: `demo_mcp_promptguard/test_server.py`

**Interfaces:**
- `GET /demo/config` returns active engine, demo config, and per-engine availability.
- `PUT /demo/config` validates and atomically applies engine plus demo config.
- `OPTIONS /demo/config` allows only the canonical origin, `GET`/`PUT`/`OPTIONS`, and `Content-Type`.
- `POST /inspect` keeps its current input and output shapes and uses the active engine for units that do not match the demo override.
- `GET /health` remains usable by Docker health checks without an `Origin` header and returns CORS permission only when called from the canonical UI origin.

- [ ] **Step 1: Add tests for demo matching, default behavior, and validation**

Extend `test_server.py` to verify: default disabled config returns no demo override; enabled `allow` suppresses only a matching request-direction `user_prompt` unit; enabled `block` yields a high-severity `prompt_injection` finding at the matching unit index; case-insensitive substring matching works; other roles/directions and nonmatching text use the fake active detector; empty phrase is rejected only when enabled; a 121-character phrase, unknown engine, unknown outcome, malformed JSON, and body over 4096 bytes are rejected. The pure mapping test should call the helper with a fake manager:

```python
class FakeManager:
    def check(self, text):
        return ALLOWED

def test_demo_block_creates_a_prompt_injection_finding():
    findings = to_findings(
        [{"role": "user_prompt", "direction": "request", "text": "DEMO phrase"}],
        FakeManager(),
        {"enabled": True, "triggerPhrase": "demo phrase", "outcome": "block"},
    )
    assert findings[0]["category"] == "prompt_injection"
    assert findings[0]["severity"] == "high"
```

- [ ] **Step 2: Add HTTP tests for origin checks, CORS preflight, and wire compatibility**

Start `make_handler(fake_manager)` on `ThreadingHTTPServer(("127.0.0.1", 0), handler)` in a test thread and send requests with `urllib.request`. Assert: allowed-origin `GET` and `PUT` succeed; `OPTIONS` returns exactly the permitted origin/method/header values; missing and foreign origins cannot access `/demo/config`; foreign `Origin` on `PUT` leaves active config unchanged; `/health` succeeds without `Origin`; `/inspect` still returns only `{"findings": [...]}` on success. Build the preflight request this way:

```python
request = urllib.request.Request(
    base_url + "/demo/config",
    method="OPTIONS",
    headers={
        "Origin": "https://local.ping-devops.com:4000",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
    },
)
```

- [ ] **Step 3: Run the sidecar checks and confirm the endpoint tests fail first**

```bash
cd demo_mcp_promptguard && python3 test_server.py
```

Expected: tests fail on the missing `/demo/config` routes and config/override helpers.

- [ ] **Step 4: Implement config validation, CORS, and finding selection**

In `server.py`, add the default in-memory config with engine `classifier`, disabled demo rule, empty trigger phrase, and `block` outcome. For the control routes, require exact `Origin: https://local.ping-devops.com:4000`, JSON content type on `PUT`, and a body length no greater than 4096 bytes. Return 403 for a disallowed origin, 400 for invalid JSON/config, and 409 when a requested engine is unavailable. Apply a request atomically only after validating both engine and demo config. For `/inspect`, apply the exact configured trigger before detector execution, then map the selected detector's normalized result into the existing Privilege finding schema. Keep log output verdict-only.

- [ ] **Step 5: Re-run all sidecar checks and commit the API**

```bash
cd demo_mcp_promptguard && python3 test_server.py
```

Expected: `ok` and exit code 0. Then:

```bash
git add demo_mcp_promptguard/server.py demo_mcp_promptguard/test_server.py
git commit -m "feat: add local PromptGuard demo config API"
```

---

### Task 4: Add the optional NeMo image profile and operator instructions

**Files:**
- Modify: `demo_mcp_promptguard/Dockerfile`
- Modify: `demo_mcp_promptguard/README.md`

**Interfaces:**
- The default Docker build installs only `requirements.txt` and works without `nemoguardrails`.
- `--build-arg PROMPTGUARD_INSTALL_NEMO=1` additionally installs `requirements-nemo.txt` and makes the NeMo engine available.
- README documents both builds, the new local control routes, localStorage draft behavior, and that the trigger rule is demo-only and global to this sidecar instance.

- [ ] **Step 1: Update Dockerfile for an opt-in NeMo dependency**

Add `ARG PROMPTGUARD_INSTALL_NEMO=0`, copy `requirements-nemo.txt`, and install it only when the argument is `1`. Copy both `server.py` and `detectors.py` into `/app`, and copy `nemo_config/` to `/app/nemo_config/`. Keep model baking and the existing health check unchanged. When the optional argument is `1`, verify the package import in the image build with `python -c "import nemoguardrails"`.

- [ ] **Step 2: Document the two runtime profiles and UI control path**

In `README.md`, show the default image build and the NeMo-enabled build, explain that NeMo is optional, document `/health`, `/inspect`, and `/demo/config`, and explain that the local UI control endpoint requires the login LaunchAgent port-forward.

- [ ] **Step 3: Build both local image profiles**

```bash
docker build --build-arg PROMPTGUARD_INSTALL_NEMO=0 -t promptguard:local-classifier demo_mcp_promptguard
docker build --build-arg PROMPTGUARD_INSTALL_NEMO=1 -t promptguard:local-nemo demo_mcp_promptguard
```

Expected: both image builds complete; the default image does not require `nemoguardrails`, while the optional image contains the package and the rail configuration. Do not push either image.

- [ ] **Step 4: Commit image and README changes**

```bash
git add demo_mcp_promptguard/Dockerfile demo_mcp_promptguard/README.md
git commit -m "docs: document optional NeMo PromptGuard image"
```

---

### Task 5: Add the LLM Gateway control panel

**Files:**
- Create: `demo_api_ui/src/pages/PromptGuardControlPanel.jsx`
- Create: `demo_api_ui/src/pages/__tests__/PromptGuardControlPanel.test.jsx`
- Modify: `demo_api_ui/src/pages/LlmGatewayPage.jsx`
- Modify: `demo_api_ui/src/pages/LlmGatewayPage.css`

**Interfaces:**
- `PromptGuardControlPanel` owns only the localhost sidecar config UI and accepts no Privilege or BFF token props.
- Mount it after `.lgw-reelband` and before `.lgw-body` with heading `PromptGuard sidecar`.
- Use a direct browser `fetch()` call, not the BFF `api()` helper or `apiClient`, because the BFF container cannot reach the user's loopback tunnel and must not receive sidecar control traffic. Set `mode: 'cors'` and `credentials: 'omit'` on every request.
- Persist only the draft under `promptguard-sidecar-config-draft`; refresh active state with `GET` after a successful `PUT`; never auto-apply a stored draft.

- [ ] **Step 1: Write control panel tests for initial and disconnected states**

Add a test response helper in `src/pages/__tests__/PromptGuardControlPanel.test.jsx` for `/health` and `/demo/config`. Assert that the default state selects `Built-in classifier`, shows `NeMo Guardrails` disabled with the dependency reason when unavailable, shows demo overrides disabled, and that a rejected health/config request shows a disconnected status without losing a stored draft. For the loaded state, stub the local sidecar responses like this:

```jsx
import { render, screen } from "@testing-library/react";
import PromptGuardControlPanel from "../PromptGuardControlPanel";

const sidecarConfig = {
  config: {
    engine: "classifier",
    demo: { enabled: false, triggerPhrase: "", outcome: "block" },
  },
  engines: [
    { id: "classifier", available: true, reason: null },
    { id: "nemo", available: false, reason: "optional_dependency_missing" },
  ],
};

function mockSidecarFetch(config = sidecarConfig, connected = true) {
  let activeConfig = config;
  global.fetch = vi.fn((url, options = {}) => {
    if (!connected) return Promise.reject(new Error("Connection refused"));
    if (String(url).endsWith("/health")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    if (String(url).endsWith("/demo/config")) {
      if (options.method === "PUT") activeConfig = JSON.parse(options.body);
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...config, config: activeConfig }) });
    }
    return Promise.reject(new Error(`Unexpected sidecar URL: ${url}`));
  });
}

it("shows the built-in detector and explains that NeMo is unavailable", async () => {
  mockSidecarFetch(sidecarConfig);
  render(<PromptGuardControlPanel />);

  expect(await screen.findByLabelText(/detector/i)).toHaveValue("classifier");
  expect(screen.getByRole("option", { name: /NeMo Guardrails/i })).toBeDisabled();
  expect(screen.getByText(/optional_dependency_missing/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused UI test and confirm it fails first**

If `demo_api_ui/node_modules` is absent, install the service dependencies first:

```bash
cd demo_api_ui && npm ci
```

Then run the focused test:

```bash
cd demo_api_ui && npm run test:unit -- src/pages/__tests__/PromptGuardControlPanel.test.jsx
```

Expected: the focused test fails because the panel component is not present.

- [ ] **Step 3: Implement loading, state, and direct loopback transport**

Create `PromptGuardControlPanel.jsx`. On mount, call `GET http://localhost:8086/health` and `GET http://localhost:8086/demo/config`. Populate active status from the server and draft controls from localStorage when present, but do not send a `PUT`. Handle unmount during requests without setting stale React state.

- [ ] **Step 4: Add tests for detector selection, config Apply, and persistence**

Assert that a ready NeMo engine can be selected; an unavailable NeMo option cannot be selected; Apply sends the exact `{engine, demo}` JSON to `PUT`; requests set `credentials: 'omit'`; success refreshes active config; validation failure preserves the draft; a matching stored draft is shown but is not applied automatically. The mocked request assertion should include:

```jsx
const expectedConfig = {
  engine: "nemo",
  demo: { enabled: true, triggerPhrase: "DEMO_TRIGGER", outcome: "block" },
};
const fetchMock = global.fetch;

expect(fetchMock).toHaveBeenCalledWith(
  "http://localhost:8086/demo/config",
  expect.objectContaining({
    method: "PUT",
    mode: "cors",
    credentials: "omit",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expectedConfig),
  }),
);
```

- [ ] **Step 5: Implement editing, Apply, and status messages**

Add detector select, enabled switch, literal phrase field, `allow`/`block` outcome, connection status, active config summary, and explicit Apply button. Require a non-empty phrase only when enabled, enforce the 120-character limit, disable NeMo when unavailable, and show the server-provided unavailable reason plus `PROMPTGUARD_INSTALL_NEMO=1` instruction. Apply sends the full config, then re-reads active config and stores the successfully applied config as the local draft. Show Apply errors without replacing the last-applied draft. Centralize the fixed local URL and transport options:

```jsx
const SIDECAR_URL = "http://localhost:8086";
const sidecarFetch = (path, options = {}) => fetch(`${SIDECAR_URL}${path}`, {
  ...options,
  mode: "cors",
  credentials: "omit",
});
```

- [ ] **Step 6: Mount and theme the control panel**

Import and render the panel in `LlmGatewayPage.jsx` after `.lgw-reelband`. Add compact responsive rules to `LlmGatewayPage.css` using `--th-*` colors and the existing font-size scale. Use no new emoji unless it is already in the repository allowlist.

- [ ] **Step 7: Run UI checks and commit the panel**

```bash
cd demo_api_ui && npm run test:unit
cd demo_api_ui && npm run build
```

Expected: all UI unit tests pass and Vite completes a production build. Check the panel in light and dark themes using both contrast snippets in `THEMING.md` §4, and verify computed styles on the rendered page. Then:

```bash
git add demo_api_ui/src/pages/PromptGuardControlPanel.jsx demo_api_ui/src/pages/__tests__/PromptGuardControlPanel.test.jsx demo_api_ui/src/pages/LlmGatewayPage.jsx demo_api_ui/src/pages/LlmGatewayPage.css
git commit -m "feat: add PromptGuard detector controls to LLM Gateway"
```

---

### Task 6: Verify the complete local demo path and finish operator setup

**Files:**
- Verify the files from Tasks 1–5; make only fixes required by the accepted checks.

**Interfaces:**
- Local UI reaches the sidecar at `localhost:8086`; normal use is through the supervisor-controlled port-forward, while integration testing temporarily binds a local sidecar image to that same loopback port.
- The remote sidecar is not changed by this task; any remote deployment remains outside the approved local-only scope.

- [ ] **Step 1: Run focused sidecar and LaunchAgent checks**

```bash
cd demo_mcp_promptguard && python3 test_server.py
bash scripts/test-promptguard-port-forward-launchd.sh
```

Expected: sidecar test runner prints `ok`; LaunchAgent script test prints `PromptGuard port-forward LaunchAgent tests passed`.

- [ ] **Step 2: Run final UI tests and build**

```bash
cd demo_api_ui && npm run test:unit
cd demo_api_ui && npm run build
```

Expected: both commands exit 0.

- [ ] **Step 3: Exercise the browser-to-loopback boundary against a local sidecar**

If the LaunchAgent currently owns 8086, pause it with `launchctl unload "$HOME/Library/LaunchAgents/com.aidemo2.promptguard-port-forward.plist"` only for this local sidecar run. Then start the built classifier image in its own terminal:

```bash
docker run --rm -d --name promptguard-local-test -p 127.0.0.1:8086:8086 promptguard:local-classifier
```

Pin the shared stack generation and serve the worktree UI before the browser drive:

```bash
gen="$(npm run -s stack:generation)"
npm run serve:worktree here
```

Open `https://local.ping-devops.com:4000/llm-gateway`. Confirm the browser can read health/config over HTTPS-to-loopback, the built-in option works, Apply updates active config, matching demo `allow` and `block` outcomes appear through `/inspect`, and unmatched text follows the selected engine. Stop the classifier container, then start the NeMo profile on the same local port:

```bash
docker stop promptguard-local-test
docker run --rm -d --name promptguard-local-test -p 127.0.0.1:8086:8086 promptguard:local-nemo
```

Confirm NeMo is selectable and detects an unmatched prompt. Confirm an unrelated web origin cannot read or change config. Stop the local container and check that the browser drive used the same stack generation:

```bash
docker stop promptguard-local-test
npm run -s stack:generation -- --check "$gen"
```

If the LaunchAgent was paused, reload it with `launchctl load "$HOME/Library/LaunchAgents/com.aidemo2.promptguard-port-forward.plist"` and verify the forwarded health endpoint returns `{"ok": true}`.

- [ ] **Step 4: Install the login LaunchAgent after the scripts exist in the stable main checkout**

After this branch is integrated and the main checkout is synced, run:

```bash
bash scripts/install-promptguard-port-forward-launchd.sh
curl -fsS http://127.0.0.1:8086/health
```

Expected: the installer reports `Installed and loaded com.aidemo2.promptguard-port-forward` and health returns `{"ok": true}`. This installs only the local macOS LaunchAgent; it does not deploy or change the remote sidecar.

- [ ] **Step 5: Review the final worktree and commit any focused fixes**

```bash
git status --short
git diff --check
```

Expected: no whitespace errors, no unrelated changes, and only the intended feature files present. Commit any focused fix in the task where it belongs; do not stage with `git add -A`.

## Acceptance Checklist

- The default sidecar runs with no NeMo package installed and reports the built-in classifier as ready.
- The NeMo choice is visible but disabled with an actionable reason when the optional dependency is absent.
- When the optional dependency is installed and initializes, the UI can switch engines while the `/inspect` schema stays unchanged.
- Demo `allow` and `block` apply only to a matching configured literal in request-direction user-prompt units; all other units use the selected detector.
- The control API rejects foreign origins and invalid config without mutating active state.
- The UI retains drafts across refresh but never applies a draft without an explicit operator action.
- The login LaunchAgent keeps the loopback port-forward available and its script test passes.
- Both optional-dependency Docker profiles build locally; neither image is pushed or remotely deployed.
- UI tests, UI production build, sidecar tests, and the two-theme contrast audit pass before declaring implementation complete.
