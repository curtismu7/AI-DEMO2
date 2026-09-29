# NeMo Guardrails PromptGuard UI Configuration

**Status:** Draft for user review
**Date:** 2026-09-29

## Context

`demo_mcp_promptguard` is the external ML guardrail sidecar used by PingOne Privilege. Privilege sends `POST /inspect` requests to port 8086 and expects the existing `{ "findings": [...] }` response. The sidecar currently runs a Hugging Face text classifier directly, with its model and threshold selected through environment variables. It has no supported way for an operator to change a predictable demo result from the UI.

The selected replacement framework is NVIDIA NeMo Guardrails. The operator control path is the local browser-to-sidecar tunnel at `http://localhost:8086`, kept available after login by the PromptGuard LaunchAgent. The Privilege webhook remains the data path; the local UI endpoint is a separate control path.

## Goals

- Run prompt-injection checks through NeMo Guardrails inside the existing sidecar.
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
3. All other units go through NeMo Guardrails' input check using the local Hugging Face classifier rail.
4. The adapter maps a NeMo block result, or a forced demo block, to the existing finding fields: category, severity, location, messages, and bounded contents. A pass produces no finding. Errors remain an HTTP 5xx so Privilege's existing fail-open/fail-closed setting remains authoritative.

Use NeMo Guardrails in-process through `IORails.check_async()` and the Hugging Face Classifier input rail. Keep the current public ProtectAI checkpoint (`protectai/deberta-v3-base-prompt-injection-v2`) as the first configured model, with the current 0.9 threshold and its `SAFE` label treated as benign. The sidecar remains a small Privilege HTTP adapter; adopting NeMo does not require deploying the separate NeMo server or Microservices platform. The async check will run through one managed async runtime so the existing HTTP handler can retain its request/response contract.

NeMo documentation uses “injection detection” for its YARA rail for code, SQL, XSS, and template injection. That rail does not classify natural-language prompt injection. The Hugging Face Classifier rail is the selected detector for this use case. References: [NeMo Python check API](https://docs.nvidia.com/nemo/guardrails/latest/run-guardrailed-inference/using-python-apis/check-messages) and [Hugging Face Classifier rail](https://docs.nvidia.com/nemo/guardrails/latest/configure-guardrails/guardrail-catalog/third-party/hf-classifier).

### Control path: local UI configuration

The LLM Gateway page calls the local sidecar directly from the user's browser:

- `GET http://localhost:8086/health` checks connectivity.
- `GET http://localhost:8086/demo/config` reads the sidecar's active demo configuration.
- `PUT http://localhost:8086/demo/config` applies a configuration.
- `OPTIONS http://localhost:8086/demo/config` handles the browser's CORS preflight for the JSON `PUT`.

The existing LaunchAgent starts the port-forward after login and retries it after interruptions or pod replacement. `kubectl port-forward` binds locally; there is no public control URL. The sidecar accepts browser control requests only from the canonical UI origin `https://local.ping-devops.com:4000`, with JSON content type and a small request-size limit. Its preflight allows only that origin, `GET`/`PUT`/`OPTIONS`, and the `Content-Type` header. Other origins receive no CORS permission and are rejected. The endpoint does not use browser cookies or carry Privilege credentials.

The HTTPS UI to local HTTP loopback request must be confirmed in the supported browser during implementation. If the browser blocks that request, the local control transport must be adjusted while preserving the same loopback-only boundary and UI behavior; a public endpoint is not an acceptable fallback.

### Demo configuration and behavior

The UI exposes:

- An enabled/disabled switch, disabled by default.
- A required literal trigger phrase, limited to 120 characters; it is not interpreted as a regular expression.
- An outcome selector: `allow` or `block`.
- Connection status, active sidecar configuration, and an explicit Apply action.

Matching is a case-insensitive literal substring match after trimming the configured phrase. It applies only to non-empty units with request direction and a user-prompt role. With `allow`, that matching unit bypasses the classifier and produces no finding. With `block`, it produces a `prompt_injection` high-severity finding. Other units continue through NeMo. This override is global to the sidecar process, so it affects any Privilege request reaching that pod whose request unit contains the phrase.

The active configuration lives in sidecar memory and resets to disabled on restart. The UI stores the last-applied values in browser `localStorage` as a draft. On page load it reads the sidecar's active value; it does not silently reapply local storage. The operator can explicitly apply the saved draft after a restart. This keeps a stale browser value from unexpectedly changing shared sidecar behavior.

The config endpoint validates the exact fields and enum values, rejects empty or oversized trigger phrases and oversized/malformed JSON, and returns a clear 4xx for invalid input. Health and config responses contain no prompt text or credentials. Existing `/inspect` response contents remain capped as they are today; logs continue to record verdicts without logging full prompt text.

## Error handling

- Tunnel unavailable: show the sidecar as disconnected and explain that the local port-forward is not responding; do not imply the demo config was applied.
- Invalid config: retain the UI draft, show the validation reason, and leave the active sidecar config unchanged.
- NeMo check failure: return the existing 5xx error path without fabricating an allow/block finding; Privilege's configured failure policy decides the outcome.
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

- `demo_mcp_promptguard/server.py`, `requirements.txt`, `Dockerfile`, `README.md`, and `test_server.py` for NeMo runtime, adapter mapping, config endpoints, and validation.
- `demo_api_ui/src/pages/LlmGatewayPage.jsx`, its page stylesheet, and focused Vitest coverage for the operator panel.
- `scripts/promptguard-port-forward.sh`, `scripts/install-promptguard-port-forward-launchd.sh`, and `scripts/test-promptguard-port-forward-launchd.sh` from the already-authorized local-tunnel work, integrated into this feature branch.

The page stylesheet must follow the existing theme tokens and the repository emoji allowlist. No PingOne auth, BFF token handling, Privilege policy, route topology, or remote deployment files are in scope.

## Verification and acceptance

- Sidecar tests cover NeMo result-to-finding mapping, demo allow/block matching, disabled and nonmatching behavior, config validation, CORS/origin rejection, health, and unchanged `/inspect` schema.
- UI tests cover loading active config, editing and applying it, local draft restoration, disconnected tunnel, and server validation errors.
- Run the focused sidecar checks, UI unit tests and UI production build, and the port-forward supervisor/LaunchAgent script checks. Run the theme contrast audit if the page stylesheet changes.
- In the supported browser, confirm the HTTPS UI can reach the loopback endpoint, the status changes with the tunnel, Apply updates the active sidecar config, the forced outcome appears through a real `/inspect` call, and an unmatched prompt still follows NeMo.
- Build the sidecar image locally to verify NeMo dependencies and model configuration. Do not push or deploy it to a remote cluster as part of this work.

## Trade-offs

- In-process NeMo keeps the existing one-container deployment and Privilege adapter small. NeMo's separate server or Microservices management plane would add infrastructure without solving this UI's local configuration need.
- Direct browser-to-loopback control preserves the chosen local tunnel path and avoids routing configuration through the BFF. It requires exact-origin CORS handling and browser verification.
- Reusing the current checkpoint avoids changing detection behavior and model licensing in the same feature. Moving to a different checkpoint can be evaluated later as a separate model decision.
