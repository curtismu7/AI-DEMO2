# B1 and B3 fix report

Scope: final-review blockers B1 and B3 only. No server, Compose, OAuth, authz, or page-error source was edited.

## Changes

- Both agent variants carry the validated callback's UC40 ID and `live-id-jag` mode through prefill, non-streaming `/nl`, fallback/clarification, and result dispatch. The agent request or direct tool request includes UC40.
- Agent and direct-tool execution begin a native PingFederate ID-JAG trace before the BFF request. Partial PF token events remain on failure; the trace settles with an error and the existing completion subscriber clears the server run grant and callback state.
- The trace rail retains PF issuance evidence when redemption fails and shows the missing hop as failed. Ordinary runs and mock replay keep their existing modes.

## Focused verification

- Red tests reproduced the dropped UC40/mode and missing failed-redemption hop before the fix.
- Vitest: 5 focused files, 45 tests passed, exit 0. Tests cover both agent variants, actual `/api/agent/invoke` and `/api/mcp/tool` request bodies, partial issuance on redemption failure, and completion cleanup.
- `cd demo_api_ui && npm run build`: exit 0.
- `git diff --check`: exit 0.

No live browser/PingFederate exchange was run. The other final-review blockers remain outside this scoped fix.
