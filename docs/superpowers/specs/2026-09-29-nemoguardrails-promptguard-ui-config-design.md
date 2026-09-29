# NeMo Guardrails PromptGuard UI Configuration

**Status:** Approved for implementation
**Date:** 2026-09-29

## Context

`demo_mcp_promptguard` is the external ML guardrail sidecar used by PingOne Privilege. Privilege sends `POST /inspect` requests to port 8086 and expects the existing `{ "findings": [...] }` response. The sidecar currently runs a Hugging Face text classifier directly, with its model and threshold selected through environment variables. It has no supported way for an operator to change a predictable demo result from the UI.

NVIDIA NeMo Guardrails is the optional second detector engine alongside the existing built-in classifier. The operator control path is the local browser-to-sidecar tunnel at `http://localhost:8086`, kept available after login by the PromptGuard LaunchAgent. The Privilege webhook remains the data path; the local UI endpoint is a separate control path.

## Goals

- Let an operator choose between the existing Hugging Face classifier and NeMo Guardrails in the existing sidecar.
- Keep NeMo optional so operators who do not install it can continue using the existing detector.
- Let an operator configure deterministic demo behavior in the LLM Gateway page.
- Keep Privilege's `/inspect` request and response contract unchanged.
- Keep the UI control endpoint reachable only through the local loopback port-forward.
- Keep demo behavior disabled by default and easy to restore after a sidecar restart.

## Non-goals

- Replacing or reconfiguring PingOne Privilege, its policies, or its webhook contract.
- Deploying the sidecar, NeMo Microservices, or other changes to a remote cluster.
- Adding a general-purpose configuration service, user/tenant profiles, or a second admin console.
- Replacing the initial classifier checkpoint or benchmarking alternative models.
- Treating the deterministic demo rule as a security policy for production traffic.

## Architecture

### Data path: Privilege inspection

1. Privilege sends its existing webhook payload to `POST /inspect` on the sidecar.
2. The sidecar checks each non-empty unit. If the demo override is enabled and a request-direction user prompt contains the configured literal trigger phrase, the configured demo outcome is used for that unit.
3. All other units go through the selected detector engine: either the current direct Hugging Face classifier or NeMo Guardrails' input check using its local Hugging Face Classifier rail.
4. The adapter maps a detector block result, or a forced demo block, to the existing finding fields: category, severity, location, messages, and bounded contents. A pass produces no finding. Errors remain an HTTP 5xx so Privilege's existing fail-open/fail-closed setting remains authoritative.

The UI exposes two detector choices:

- **Built-in classifier** is the current direct `transformers` pipeline and remains the default. It uses the existing base dependencies and works without NeMo installed.
- **NeMo Guardrails** uses the in-process `IORails.check_async()` API and its Hugging Face Classifier input rail. It is an optional sidecar dependency, installed from `requirements-nemo.txt` or enabled with Docker build argument `PROMPTGUARD_INSTALL_NEMO=1` (default `0`). If NeMo is absent or failed initialization, the UI keeps the option visible but disabled with an install/readiness explanation; the sidecar rejects attempts to select an unavailable engine.

Both engines use the current public ProtectAI checkpoint (`protectai/deberta-v3-base-prompt-injection-v2`), current 0.9 threshold, and `SAFE` benign label. This isolates the choice to the runtime framework, not the model. The sidecar remains a small Privilege HTTP adapter; adopting NeMo does not require deploying the separate NeMo server or Microservices platform. Only the selected detector runtime is kept active. A switch is serialized with inspection requests; if the new engine fails to initialize, the sidecar restores the previous engine and active config. The NeMo async check will run through one managed async runtime so the existing HTTP handler can retain its request/response contract.

NeMo documentation uses “injection detection” for its YARA rail for code, SQL, XSS, and template injection. That rail does not classify natural-language prompt injection. The Hugging Face Classifier rail is the selected detector for this use case. References: [NeMo Python check API](https://docs.nvidia.com/nemo/guardrails/latest/run-guardrailed-inference/using-python-apis/check-messages) and [Hugging Face Classifier rail](https://docs.nvidia.com/nemo/guardrails/latest/configure-guardrails/guardrail-catalog/third-party/hf-classifier).

### Control path: local UI configuration

The LLM Gateway page calls the local sidecar directly from the user's browser:

- `GET http://localhost:8086/health` checks connectivity.
- `GET http://localhost:8086/demo/config` reads the active detector, demo configuration, and available detector choices.
- `PUT http://localhost:8086/demo/config` applies the detector selection and demo configuration.
- `OPTIONS http://localhost:8086/demo/config` handles the browser's CORS preflight for the JSON `PUT`.

The existing LaunchAgent starts the port-forward after login and retries it after interruptions or pod replacement. `kubectl port-forward` binds locally; there is no public control URL. The sidecar accepts browser control requests only from the canonical UI origin `https://local.ping-devops.com:4000`, with JSON content type and a small request-size limit. Its preflight allows only that origin, `GET`/`PUT`/`OPTIONS`, and the `Content-Type` header. Other origins receive no CORS permission and are rejected. The endpoint does not use browser cookies or carry Privilege credentials.

The HTTPS UI to local HTTP loopback request must be confirmed in the supported browser during implementation. If the browser blocks that request, the local control transport must be adjusted while preserving the same loopback-only boundary and UI behavior; a public endpoint is not an acceptable fallback.

### Demo configuration and behavior

The UI exposes:

- A detector selector for `Built-in classifier` and `NeMo Guardrails`, including availability/readiness state and a clear reason when NeMo is not installed or initialized.
- An enabled/disabled switch, disabled by default.
- A literal trigger phrase, required when the demo override is enabled and limited to 120 characters; it is not interpreted as a regular expression.
- An outcome selector: `allow` or `block`.
- Connection status, active sidecar configuration, and an explicit Apply action.

Matching is a case-insensitive literal substring match after trimming the configured phrase. It applies only to non-empty units with request direction and a user-prompt role. With `allow`, that matching unit bypasses the selected detector and produces no finding. With `block`, it produces a `prompt_injection` high-severity finding. Other units continue through the selected detector. This override is global to the sidecar process, so it affects any Privilege request reaching that pod whose request unit contains the phrase.

The active detector and demo configuration live in sidecar memory. The detector resets to the built-in classifier on restart; the demo override resets to disabled. The UI stores the last-applied values in browser `localStorage` as a draft. On page load it reads the sidecar's active value; it does not silently reapply local storage. The operator can explicitly apply the saved draft after a restart. This keeps a stale browser value from unexpectedly changing shared sidecar behavior.

The config response includes the active engine, demo settings, and an availability/readiness reason for each engine. The config endpoint validates the exact fields and enum values, requires a non-empty trigger phrase only while the demo override is enabled, rejects phrases over 120 characters and oversized/malformed JSON, and returns a clear 4xx for invalid input. A request to select an unavailable engine returns a clear 4xx and leaves the active engine/config unchanged. Health and config responses contain no prompt text or credentials. Existing `/inspect` response contents remain capped as they are today; logs continue to record verdicts without logging full prompt text.

## Error handling

- Tunnel unavailable: show the sidecar as disconnected and explain that the local port-forward is not responding; do not imply the demo config was applied.
- NeMo unavailable: leave the built-in classifier selectable, disable the NeMo choice, explain whether the dependency is missing or failed initialization, and show how to rebuild the sidecar with `PROMPTGUARD_INSTALL_NEMO=1`. Installation is an operator action, not something the browser performs.
- Detector switch fails: keep the previous detector active and report the failure; do not claim the requested detector was applied.
- Invalid config: retain the UI draft, show the validation reason, and leave the active sidecar config unchanged.
- Selected detector check failure: return the existing 5xx error path without fabricating an allow/block finding; Privilege's configured failure policy decides the outcome.
- Sidecar restart: active config returns to disabled; the browser draft remains available for explicit reapplication.
- Simultaneous browser edits: last successful `PUT` wins; the UI refreshes the active config after Apply and labels it as shared sidecar state.

## Security and privacy boundaries

- Bind the tunnel to loopback only and do not expose the control routes through ingress, a public service, or the BFF.
- Accept the control request only from the canonical UI origin and validate all input server-side. CORS is an additional browser boundary, not user authentication; any local process able to reach the loopback port is within this demo's trust boundary.
- Keep the deterministic override disabled by default, exact in scope to a configured phrase, and visibly labeled as demo behavior.
- Do not log full prompt text, store prompts in the config, or persist config on the sidecar volume.
- Keep existing Privilege credentials, tokens, and webhook payloads out of the UI control calls.

## Files and boundaries

Expected implementation changes:

- `demo_mcp_promptguard/server.py`, `requirements.txt`, an optional NeMo requirements file, `Dockerfile`, `README.md`, and `test_server.py` for both detector engines, adapter mapping, config endpoints, and validation.
- `demo_api_ui/src/pages/LlmGatewayPage.jsx`, its page stylesheet, and focused Vitest coverage for the operator panel.
- `scripts/promptguard-port-forward.sh`, `scripts/install-promptguard-port-forward-launchd.sh`, and `scripts/test-promptguard-port-forward-launchd.sh` from the already-authorized local-tunnel work, integrated into this feature branch.

The page stylesheet must follow the existing theme tokens and the repository emoji allowlist. No PingOne auth, BFF token handling, Privilege policy, route topology, or remote deployment files are in scope.

## Verification and acceptance

- Sidecar tests cover both detector mappings, behavior when NeMo is not installed, detector switching/failure, demo allow/block matching, disabled and nonmatching behavior, config validation, CORS/origin rejection, health, and unchanged `/inspect` schema.
- UI tests cover loading detector availability, selecting and applying each available detector, disabled NeMo with an install hint, local draft restoration, disconnected tunnel, and server validation errors.
- Run the focused sidecar checks, UI unit tests and UI production build, and the port-forward supervisor/LaunchAgent script checks. Run the theme contrast audit if the page stylesheet changes.
- In the supported browser, confirm the HTTPS UI can reach the loopback endpoint, the status changes with the tunnel, both detector choices work when installed, NeMo is clearly unavailable when omitted, Apply updates the active config, the forced outcome appears through a real `/inspect` call, and an unmatched prompt follows the selected detector.
- Build the sidecar image locally both with `PROMPTGUARD_INSTALL_NEMO=0` and `PROMPTGUARD_INSTALL_NEMO=1` to verify the two supported profiles. Do not push or deploy it to a remote cluster as part of this work.

## Trade-offs

- Keeping the built-in classifier as the default means an operator can demo the sidecar without the larger optional NeMo dependency. Installing NeMo adds image size and initialization cost, but enables an apples-to-apples runtime choice with the same checkpoint.
- In-process NeMo keeps the existing one-container deployment and Privilege adapter small. NeMo's separate server or Microservices management plane would add infrastructure without solving this UI's local configuration need.
- Direct browser-to-loopback control preserves the chosen local tunnel path and avoids routing configuration through the BFF. It requires exact-origin CORS handling and browser verification.
- Reusing the current checkpoint avoids changing detection behavior and model licensing in the same feature. Moving to a different checkpoint can be evaluated later as a separate model decision.
