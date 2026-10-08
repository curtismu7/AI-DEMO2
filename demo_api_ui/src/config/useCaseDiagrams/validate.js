/**
 * Structural validation shared by every UC config test and the drift test.
 * Checks the StaticFlowDiagram contract: node ids unique, edges reference real
 * nodes, walk steps reference real edge indexes and nodes, tech rows well-formed,
 * every node carries its click-to-inspect detail sentence.
 */
export function validateConfig(cfg) {
  const errors = [];
  const ids = new Set(cfg.NODES.map((n) => n.id));
  if (ids.size !== cfg.NODES.length) errors.push("duplicate node id");
  cfg.EDGES.forEach(([src, tgt], i) => {
    if (!ids.has(src) || !ids.has(tgt)) errors.push(`edge ${i}: unknown node ${!ids.has(src) ? src : tgt}`);
  });
  const edgeCount = cfg.EDGES.length;
  cfg.walk.forEach((w, i) => {
    if (!w.title) errors.push(`walk ${i}: missing title`);
    (w.edges || []).forEach((e) => { if (e < 0 || e >= edgeCount) errors.push(`walk ${i}: edge index ${e} out of range`); });
    (w.nodes || []).forEach((n) => { if (!ids.has(n)) errors.push(`walk ${i}: unknown node ${n}`); });
    (w.tech || []).forEach((row, j) => {
      if (!/^(API|TOKEN|A2A|POLICY)$/.test(row.t || "")) errors.push(`walk ${i} tech ${j}: bad tag`);
      if (!row.c) errors.push(`walk ${i} tech ${j}: missing content`);
    });
  });
  cfg.NODES.forEach((n) => {
    if (!n.detail) errors.push(`node ${n.id}: missing detail`);
  });
  return { ok: errors.length === 0, errors };
}
