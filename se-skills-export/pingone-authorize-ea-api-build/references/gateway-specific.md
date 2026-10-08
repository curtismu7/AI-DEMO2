# Gateway-Specific Notes

Everything in the rest of this skill is true regardless of which gateway is making the sideband call to PingOne Authorize — it's PingOne Authorize's own behavior. This file covers the small slice of genuinely gateway-specific facts.

## PingGateway

**A policy tree cannot resolve decisions until the gateway itself is connected.** If you hit a "Failed to build policy tree" error (or similar), check that PingGateway is actually registered/connected to the API Server before assuming the policy content itself is broken.

**`PingAuthorizeFilter` has no client-facing deny-handler property.** Per PingGateway's reference documentation, this filter accepts only: `gatewayServiceUri`, `secretsProvider`, `gatewayCredentialSecretId`, `includeBodyContentTypes`, `sidebandHandler`, `accessToken`, `sharedSecretHeaderName`. There is **no** `failureHandler`, `denyHandler`, `accessDeniedHandler`, or equivalent property. `sidebandHandler` is the *outbound* handler used to reach the Sideband API — it is not a hook for customizing the client-facing response on DENY.

If you need to customize the DENY response shape returned to the client (rather than passing through PingOne Authorize's raw Sideband response body verbatim), the confirmed working pattern is a `ScriptableFilter` placed in the route's filter chain **before** the `AuthorizePolicyDecision` filter, wrapping `next.handle(context, request)` in a `.thenOnResult { response -> ... }` callback that inspects and optionally rewrites the response *after* the downstream chain (including the authorize decision) has already run. Match on the specific error shape you want to rewrite (e.g. a substring check on the raw entity body) rather than blanket-rewriting every 403, so you don't accidentally relabel a DENY from some other source.

**Watch for dead config.** A `StaticResponseHandler` (or similar heap object) referenced nowhere in the actual filter chain or `PingAuthorizeFilter` config is silently inert — it will not do anything, and no error will indicate this. Confirm any custom handler is actually wired into the live route config (check the deployed ConfigMap/route JSON directly, not just the source file you think is deployed) before assuming it's active.

## Kong

**Prefer `kong-plugin-ping-auth` (the maintained LuaRocks plugin) over a DIY `pre-function` script** for making the sideband call to PingOne Authorize. This was evaluated directly against a hand-rolled `pre-function` approach and the maintained plugin was the better-supported, less fragile choice for the core sideband request/response handling.

**If you need to promote a query parameter or other request data into a header before the sideband call** (e.g. because a downstream PingOne resolver needs it in header form rather than query-parameter form for some structural reason), a `request-transformer`-style plugin (or a scoped `pre-function` specifically for that narrow transformation) is a reasonable pattern — but check `resolvers-and-attributes.md`'s array-wrapping gotcha first, since Query Parameters may already work fine directly with the `[0]` index fix, without needing any Kong-side transformation at all. Don't build header-forwarding infrastructure preemptively; confirm the native resolver genuinely can't do what you need first.

**Verify what's actually deployed.** Kong config (plugins on a route) can drift from what a repo/ConfigMap says is intended, the same way PingGateway's route config can. Check the live Kong Admin API or declarative config actually applied, not just the source file, when debugging unexpected behavior.
