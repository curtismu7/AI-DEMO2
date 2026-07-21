# "Decode my token" JWT-Verifier Demo Chip — Design Spec

**Date:** 2026-07-20
**Status:** Approved for implementation
**Branch:** `worktree-jwt-decode-chip-spec` (design only) → implementation in a follow-up worktree

## Goal

Give the `demo_mcp_jwt_verifier` MCP backend (added in PR #654, PingOne-provisioned in
PR #657) a clickable, testable path in the demo UI: a chip that decodes the
current user's own live agent-issued bearer token via `jwt_decode_full`,
available in every vertical (not just banking).

Today there is no UI path to this backend at all — it is reachable only via
raw MCP JSON-RPC calls through the gateway. This closes that gap.

## Non-goals

- No new chips for the other 4 jwt-verifier tools (`jwt_verify_signature`,
  `jwt_validate_claims`, `jwt_fetch_jwks`, `jwt_inspect_key`) — one chip only,
  per the approved design.
- No new "shared chips" mechanism in the vertical loader
  (`demo_api_server/services/verticalManifest/loader.js`) — the chip entry is
  duplicated into each vertical's `manifest.json`, matching the existing
  per-vertical architecture exactly rather than inventing a new capability.
- No change to `BankingChips.jsx` — it already renders whatever chips the
  active vertical's manifest provides (confirmed: it's a generic,
  `useVertical()`-driven renderer despite the filename, not banking-specific).

## Architecture / data flow

1. User clicks the new chip (`bk-jwt`, label "Decode my token") in any
   vertical's chip list.
2. `demo_api_ui/src/components/AIAgent.js` gets one new hardcoded branch —
   `callMcpTool("jwt_decode_full", {}, {useCaseId: "jwt-token-inspect", vertical})`
   — empty client-side params, identical shape to existing direct-mode chip
   branches (e.g. `show_mortgage` at `AIAgent.js:2687`, `user_profile_card` at
   `AIAgent.js:3886`).
3. Request lands on `POST /api/mcp/tool` (`demo_api_server/server.js:1723`,
   `requireSession`-gated). New logic: when `tool === 'jwt_decode_full'` and
   `params.token` is empty, fill `params.token` with the session's own
   resolved access/agent token — the same token this route already resolves
   to authenticate its own outbound gateway call. **The exact variable name
   is not yet pinned to a line number** — the implementation step must locate
   it (grep the existing outbound-call construction further down this route
   handler) rather than guess. The raw token is filled in server-side and
   never becomes a literal in any client-visible payload.
4. The route forwards `{tool: 'jwt_decode_full', params: {token}}` onward
   through the existing MCP-tool-call pipeline → `mcp-gateway` RFC 8693
   re-exchanges to the `mcp-jwt-verifier.ping.demo` audience →
   `demo_mcp_jwt_verifier` decodes and returns `{header, payload, hasSignature,
   summary, isExpired}`.
5. This route already scrubs any JWT-shaped string from every JSON response
   (`scrubRawJwts`, `server.js:1731`, `services/jwtScrubber.js`).
   `jwt_decode_full`'s output is decoded claims (JSON objects), not a raw
   compact JWT string, so it should pass through unaffected — **verify this
   explicitly during implementation** (run the scrubber against a real
   response) rather than assume it.

## Touch points

1. **`demo_api_ui/src/components/AIAgent.js`** — one new `callMcpTool(...)`
   branch for `jwt_decode_full`, mirroring the existing per-tool branches.
2. **`demo_api_server/server.js`** (`POST /api/mcp/tool` handler,
   `server.js:1723`) — small addition: auto-fill `params.token` from the
   session's resolved agent token when the tool is `jwt_decode_full` and no
   token was supplied.
3. **`demo_api_server/config/verticals/<vertical>/manifest.json`** — the same
   chip entry duplicated into every real (non-hidden) vertical:
   `banking`, `retail`, `healthcare`, `government`, `investment`,
   `manufacturing`, `sporting-goods`, `university`, `workforce`. Skipped:
   `admin`, `admin-console`, `oauth-teaching` (hidden per
   `verticalManifest/index.js:16`'s `HIDDEN_IDS`), and `a2a` /
   `pingone-admin` (special-purpose verticals outside the standard vertical
   switcher — not in scope for this pass).

   ```json
   { "id": "bk-jwt", "label": "Decode my token", "message": "decode my token", "mode": "both", "tool": "jwt_decode_full", "useCaseId": "jwt-token-inspect" }
   ```

4. **`demo_api_ui/src/config/demoUseCaseSteps.js`** — register
   `jwt-token-inspect` so the chip's flow shows up in the Demo Steps dropdown
   (mirroring how other `useCaseId`s are registered there).

## Error handling

- No session / expired session → the route already 401s upstream of this
  addition; nothing new to handle.
- Gateway or `demo_mcp_jwt_verifier` unreachable → falls through the existing
  chip error-toast path used by every other tool failure; no new UI needed.
- `jwt_decode_full` itself only fails on a malformed token (wrong part count)
  — since the token is server-resolved from an active session, this should
  not occur in practice, but the tool's existing error path
  (`InvalidTokenError` → MCP `isError: true` response) is unchanged and
  sufficient.

## Testing

- Manual click-through once the local stack is up (`./run.sh` or
  `./run-docker.sh demo-auth start`, `demo-auth` profile for `mcp-gateway` +
  `mcp-jwt-verifier`): log in, click "Decode my token" in at least banking and
  one other vertical, confirm the response shows real header/payload for the
  logged-in session's own token (issuer, subject, expiry all match what's
  expected for that session).
- Existing jest suites unaffected — this adds a new tool/route branch, not a
  behavior change to existing paths; run the gateway and BFF suites as a
  regression check same as prior PRs in this line of work.
- No new automated end-to-end test is in scope for this pass (manual
  verification only) — `tests/real/shared/chip-pipeline.test.js` is a
  reasonable template if automated coverage is wanted later.

## Open items for the implementation plan

- Pin the exact session-token variable name/line in `server.js`'s
  `/api/mcp/tool` handler before writing the injection logic.
- Confirm whether `a2a` / `pingone-admin` verticals should also get the chip.
