// Turns a diagram's nodes and edges into the movie reel: one card per arrow, in walk order, plus the
// text the details row shows for a card or a node. `details` is an optional map of node id -> a string
// (or { title, body }) that overrides the node's own detail lines.

const firstLine = (s) => String(s ?? "").split("\n")[0].trim();

function detailText(node, details) {
  const d = details?.[node?.id];
  if (d) return typeof d === "string" ? d : d.body || "";
  return (node?.sub || []).filter(Boolean).join(" · ");
}

/** One entry per arrow: { n, from, to, fromLabel, toLabel, label, title, lines: [{ who, text }] }. */
export function buildReelSteps({ edges, nodes, details }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return edges.map((e, i) => {
    const [from, to, rawLabel] = Array.isArray(e) ? e : [e.source ?? e.from, e.target ?? e.to, e.label ?? e.data?.label];
    const a = byId[from];
    const b = byId[to];
    const fromLabel = firstLine(a?.label ?? from);
    const toLabel = firstLine(b?.label ?? to);
    const label = String(rawLabel ?? "").replace(/\n/g, " ").trim();
    const lines = [];
    const fromText = detailText(a, details);
    const toText = detailText(b, details);
    if (fromText) lines.push({ who: fromLabel, text: fromText });
    if (toText && to !== from) lines.push({ who: toLabel, text: toText });
    return { n: i + 1, from, to, fromLabel, toLabel, label, title: `${fromLabel} → ${toLabel}`, lines };
  });
}

/** The details row content for one node: { title, lines: [{ who, text }] }. */
export function buildNodeDetail(node, details) {
  if (!node) return null;
  const text = detailText(node, details);
  return { title: firstLine(node.label), lines: text ? [{ who: "", text }] : [] };
}

/**
 * pingStyle: fold STEPS[i].detail = { form?, tokens?: [{ note, header?, claims }], refs?: [{ id, title, kind }] } into the
 * reel steps. Reel step k is EDGES[k]; STEPS[i].edges lists the edge indexes a step covers, so every arrow in
 * STEPS[i].edges shows STEPS[i].detail (request form, then each mock token, then the standards list).
 */
export function withStepDetail(reelSteps, steps) {
  const byEdge = {};
  (steps || []).forEach((s) => s.detail && (s.edges || []).forEach((e) => { byEdge[e] = s.detail; }));
  return reelSteps.map((r, i) => {
    const d = byEdge[i];
    if (!d) return r;
    const lines = [...r.lines];
    if (d.form) lines.push({ who: "Request", code: d.form });
    (d.tokens || []).forEach((t) => {
      const decoded = { ...(t.header ? { header: t.header } : {}), claims: t.claims };
      lines.push({ who: `Token: ${t.note.split("·")[0].trim()}`, code: `${t.note} (MOCK, teaching values only)\n${JSON.stringify(decoded, null, 2)}` });
    });
    return { ...r, lines, refs: d.refs || r.refs };
  });
}
