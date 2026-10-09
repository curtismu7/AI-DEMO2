// demo_api_ui/src/services/tokenChainTrace/ucLiveOverlay.js
//
// Live overlay for the curated UC diagram pages: when the trace store holds a
// run whose use-case slug matches the page's config, the walk is rebuilt from
// the hops that run actually performed (fired hops only — the shared
// visibility policy). No matching run -> null, and the page renders its
// curated fallback untouched. Slug matching is config-side: useCaseId slugs
// are shared across verticals by design (ProofOfEnforcementContext comment),
// so one `slug` line per config replaces a catalog fetch.
import { applyStepVisibility } from "./stepVisibility";
import { firstUseCaseId } from "../../context/ProofOfEnforcementContext";

const LANE_TAG = { API: "API", MCP: "API", BROWSER: "API", PINGONE: "POLICY", PINGFEDERATE: "POLICY", HEURISTICS: "POLICY" };

/**
 * Rebuild the curated UC walk from the trace's fired hops.
 * @param {object} cfg   a useCaseDiagrams config (needs `slug` + `hopHints`)
 * @param {object} trace the store trace
 * @param {Array}  steps buildTraceSteps output for that trace
 * @returns {Array|null} walk steps in the curated shape, or null when this run
 *                       doesn't belong to this page (caller keeps its fallback)
 */
export function buildLiveUcWalk(cfg, trace, steps) {
  if (!cfg?.hopHints || !trace) return null;
  const slug = firstUseCaseId(trace);
  if (!slug || cfg.slug !== slug) return null;
  const { visible } = applyStepVisibility(steps, trace);
  const walk = [];
  for (const step of visible) {
    const baseId = step.baseId || step.id;
    const nodes = cfg.hopHints[baseId];
    if (!nodes?.length) continue;
    const edges = cfg.EDGES
      .map(([src, tgt], i) => (nodes.includes(src) && nodes.includes(tgt) ? i : -1))
      .filter((i) => i >= 0);
    const text = step.detail?.why || step.detail?.narrative || step.title;
    walk.push({
      title: step.title.length > 44 ? `${step.title.slice(0, 41)}…` : step.title,
      label: step.status === "error" ? "denied / failed in this run" : "observed in this run",
      nodes,
      edges,
      lines: [{ who: step.lane || "RUN", text }],
      tech: (step.detail?.kv || []).slice(0, 3)
        .map(([k, v]) => ({ t: LANE_TAG[step.lane] || "TOKEN", c: `${k}: ${v}` })),
    });
  }
  return walk.length ? walk : null;
}
