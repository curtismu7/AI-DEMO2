// Steps for a support-console operator write. Same relationship to the trace
// store as privilegeA2aChainSteps: when the events carry this vocabulary the
// chain IS the operator story, so every view that reads the store's steps shows
// it instead of a banking pipeline the write never ran. Events come from the
// BFF write response (services/operatorTokenChain.js server-side).
//
// `vertical` scopes the projection: the trace store is global, so a console
// passes its own vertical and shows only chains minted for it. Without a
// vertical (store-level callers, other surfaces) events pass unfiltered.

// Ceremony hops the delegation write interleaves with the operator- ones. They
// are not operator- prefixed, so the prefix filter alone would silently drop
// them and the rail would tell a partial story.
const CEREMONY_IDS = new Set(["customer-signon", "customer-token-issued", "exchange"]);

export function buildOperatorChainSteps(tokenEvents, vertical = null) {
  // Only a real operator write claims the trace. Ceremony ids ("exchange"
  // among them) also appear on ordinary agent runs — the AG-UI session preview
  // seeds an id-'exchange' waiting placeholder on every dashboard run — so
  // letting them trigger this projection collapsed every agent run's chain to
  // a single "BFF Exchange / waiting" node. Ceremony hops qualify steps; only
  // operator- events trigger them.
  const hasOperatorEvents = (Array.isArray(tokenEvents) ? tokenEvents : [])
    .some((event) => typeof event?.id === "string" && event.id.startsWith("operator-"));
  if (!hasOperatorEvents) return [];
  const events = (Array.isArray(tokenEvents) ? tokenEvents : [])
    .filter((event) => typeof event?.id === "string"
      && (event.id.startsWith("operator-") || CEREMONY_IDS.has(event.id)))
    .filter((event) => !vertical || !event.vertical || event.vertical === vertical);
  if (!events.length) return [];

  return events.map((event) => ({
    id: event.id,
    title: event.label || event.id,
    lane: event.id === "operator-session" ? "BROWSER"
      : event.id === "customer-signon" || event.id === "customer-token-issued" ? "PINGONE"
      : event.id === "operator-verification" ? "PINGONE"
      : event.id === "exchange" ? "BFF"
      : event.id === "operator-write" ? "API"
      : "DATA",
    status: event.status || "done",
    detail: {
      narrative: event.explanation,
      kv: [
        ...Object.entries(event.claims || {}).map(([k, v]) => [
          // beforeStatus/afterStatus are the write's claims verbatim; the rail
          // shows them as the transition they are.
          k === "beforeStatus" ? "before" : k === "afterStatus" ? "after" : k,
          String(v),
        ]),
        ...(event.verifiedUntil ? [["verified until", event.verifiedUntil]] : []),
      ],
      ...(event.request ? {
        // HTTP hops carry { method, url }; the RFC 8693 exchange hop carries
        // { audience, scope, hasActor, actorClientId }. Render each shape as
        // what it actually is, never "undefined undefined".
        request: {
          title: "Request (actual)",
          text: event.request.method
            ? `${event.request.method} ${event.request.url}`
            : `grant_type=token-exchange · audience: ${event.request.audience} · scope: ${event.request.scope} · actor: ${event.request.hasActor ? `yes (${event.request.actorClientId})` : "no"}`,
        },
      } : {}),
      ...(event.result ? {
        response: { title: "Result", text: JSON.stringify(event.result, null, 2) },
      } : {}),
      tokenEvent: event,
    },
  }));
}
