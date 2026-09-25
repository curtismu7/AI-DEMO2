# PingOne Protect standalone browser evaluation

This plan replaces the earlier OIDC-gated sign-in design. The dedicated page
collects Signals and displays PingOne Protect's response only. It does not
perform sign-in, MFA step-up, agent dispatch, or a local access decision.

## Changes

- Page: run the Signals SDK, send its payload to the BFF, and render risk level,
  recommended action, and available bot-detection fields. Keep the page available
  in-app and as a pop-out, with light/dark mode.
- BFF: keep PingOne credentials server-side, add server-derived request context,
  validate the request, and return a sanitized Protect response without an
  authentication completion handle.
- Agent: remove UC36, its Demo Steps entry, agent-specific Signals collection,
  dispatch gate, feature flag, and trace row. The browser evaluation page remains
  under **Ping products**.
- OAuth: remove the Protect callback branch and marker. Ordinary SDK OIDC login
  and callback continue unchanged.

## Verification record

- Added regression coverage that proves the page displays Protect results without
  starting an OIDC client, and that ordinary SDK callbacks ignore an old Protect
  marker.
- Added BFF response-sanitization and agent-catalog regression coverage.
- Build the UI and run focused UI/BFF checks before merging.
