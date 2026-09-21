# Academy Personal-Agent Client Integration

## Mission

Make the Academy's Personal Agent lesson explain and launch the two external-agent forms customers are likely to recognize:

- LibreChat: a browser-based personal agent.
- LM Studio: a personal agent running locally on a user's Mac.

The app owns the identity, consent, gateway, policy, and evidence story. It does not claim to control the agent's private reasoning or local runtime.

## Scope

This slice is UI/catalog integration only. It will reuse the existing Personal Agent Studio, LibreChat endpoint, MCP/Privilege setup pages, and Academy lesson catalog. It will not create a new MCP server, new OAuth client, or new external-client backend.

The slice will provide:

1. A shared client catalog with accurate client type, runtime, launch behavior, and security concepts.
2. A Personal Agent Studio client panel with grouped cards and explanatory chips.
3. Academy-facing links so the Personal Agent lesson leads to the two client forms.
4. Explicit side-nav entries for LibreChat (browser) and LM Studio (Mac), with Demo Config discoverability.

## User journey

The presenter opens Personal Agent from the Academy, chooses a client form, sees the boundary, then launches or opens setup:

`Personal Agent → LibreChat browser / LM Studio Mac → CIMD/DCR or local MCP setup → OAuth consent → per-tool authorization → gateway evidence`

LibreChat launches the configured local browser app at `http://localhost:3080`. LM Studio opens the in-app MCP/Privilege setup surface with the client context in the URL; it cannot be launched by a browser link as a native Mac application.

## Navigation and naming

- Keep the existing `Personal Agent` route at `/personal-agent`.
- Rename the side-nav entry to `LibreChat (browser)` so its runtime is clear.
- Add `LM Studio (Mac)` beside it under Learn & Present.
- Keep labels in `NAV_STRUCTURE_CATALOG`, `NAV_PAGE_PATHS`, and Demo Config aligned.
- Add search aliases for `browser personal agent`, `mac personal agent`, `LibreChat`, and `LM Studio`.

## Evidence and copy rules

The client cards are explanatory and launch/setup controls, not simulated evidence. They must state the control boundary plainly:

- LibreChat is an external browser client; Ping controls the connection and protected resources.
- LM Studio is a local Mac client; Ping controls the protected MCP path, not the local model process.
- Both clients still pass through registration/metadata, OAuth, consent, per-tool policy, and gateway enforcement where configured.

## Verification

- Unit tests cover the catalog, client cards, and side-nav labels/targets.
- Existing Personal Agent and navigation tests remain green.
- `cd demo_api_ui && npm run test:unit` and `npm run build` must pass.
- Validate both light and dark theme rendering for the new card surface.
