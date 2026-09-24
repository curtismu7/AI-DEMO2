# B1/B3 clarification and fallback fix

## Changes

- Both agent variants carry the saved UC40 `useCaseId` and validated `live-id-jag` mode through typed clarification. The resulting tool request carries UC40 to the BFF and starts a native PF trace.
- Clarification and explicit heuristic fallback leave the native trace open while awaiting the presenter. The auth completion subscriber consumes the server grant only after the actual tool request completes, or after an explicit fallback dismissal/terminal error.
- The legacy agent response path does not settle a native missing-parameter reply before the follow-up. Ordinary agent trace outcomes retain their previous behavior.

## Verification

- `npm run test:unit -- src/components/__tests__/AIAgent.idJagClarification.test.jsx src/services/__tests__/demoAgentService.legacyTrace.test.js --silent --reporter=dot`: 2 files, 16 tests passed, exit 0.
- `npm run build`: exit 0; Vite built 5,643 modules. The build emitted its existing large-chunk warning and a missing local mkcert notice while continuing in HTTP-only mode.
- `git diff --check`: exit 0.

The focused component tests mount the real auth completion subscriber and real direct-tool service. They assert the outbound `/api/mcp/tool` UC40 metadata, native trace mode, no completion POST during clarification/fallback, and one completion POST after the tool response. No live PingFederate browser exchange was run in this scoped fix.
