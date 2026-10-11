// Steps for a support-console operator write. Same relationship to the trace
// store as privilegeA2aChainSteps: when the events carry this vocabulary the
// chain IS the operator story, so every view that reads the store's steps shows
// it instead of a banking pipeline the write never ran. Events come from the
// BFF write response (services/operatorTokenChain.js server-side).
//
// `vertical` scopes the projection: the trace store is global, so a console
// passes its own vertical and shows only chains minted for it. Without a
// vertical (store-level callers, other surfaces) events pass unfiltered.
export function buildOperatorChainSteps(tokenEvents, vertical = null) {
  const events = (Array.isArray(tokenEvents) ? tokenEvents : [])
    .filter((event) => typeof event?.id === "string" && event.id.startsWith("operator-"))
    .filter((event) => !vertical || !event.vertical || event.vertical === vertical);
  if (!events.length) return [];

  return events.map((event) => ({
    id: event.id,
    title: event.label || event.id,
    lane: event.id === "operator-session" ? "BROWSER"
      : event.id === "operator-verification" ? "PINGONE"
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
        request: { title: "Request (actual)", text: `${event.request.method} ${event.request.url}` },
      } : {}),
      ...(event.result ? {
        response: { title: "Result", text: JSON.stringify(event.result, null, 2) },
      } : {}),
      tokenEvent: event,
    },
  }));
}
