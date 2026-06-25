/*
 * PolicyDecisionTree.jsx
 *
 * Renders the PingOne Authorize admin "Test" diagram for a *live* decision:
 * the real Policy Set -> Policy -> Rule tree with the decision's result
 * overlaid (taken path highlighted green, inactive branches greyed "N/A",
 * statement bubbles, overall verdict + timing).
 *
 * IMPORTANT fidelity note (surfaced in the legend): PingOne's public decision
 * endpoint API returns only the overall `decision`, the `statements` that
 * fired, and `elapsedMicroseconds`. It does NOT return a per-node evaluation
 * trace. So the per-node active/N-A badges below are DERIVED here by matching
 * the returned statements to their rule nodes (by outcome kind + name), not a
 * verbatim PingOne trace. The overall decision, statements, and total timing
 * are real PingOne data.
 *
 * Props:
 *   policies : Array  - normalized policy-tree roots from
 *                       GET /api/authorize/pingone-policies (.policies)
 *   result   : Object - the /api/authorize/evaluate-endpoint response
 *                       (decision, stepUpRequired, consentRequired, raw{...})
 */
import "./PolicyDecisionTree.css";

const STOP = new Set([
  "for", "the", "of", "a", "an", "to", "and", "is", "be", "on", "or",
  "required", "transaction", "transactions",
]);

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && t.length > 1 && !STOP.has(t));
}

// Classify free text (a statement name/code or a rule name) into an outcome kind.
function kindFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/deny|denied|block|reject/.test(t)) return "deny";
  if (/step.?up|\bmfa\b|multi.?factor/.test(t)) return "step_up";
  if (/consent|hitl|human|approval.?required|requires.?approval/.test(t)) return "consent";
  if (/approv|permit|allow|standard/.test(t)) return "permit";
  return null;
}

function ruleKind(node) {
  return (
    kindFromText(node.name) ||
    (node.effect === "DENY" ? "deny" : node.effect === "PERMIT" ? "permit" : null)
  );
}

// Map the normalized evaluate result to one overall display token.
function overallDecision(result) {
  if (!result) return "INDETERMINATE";
  if (result.stepUpRequired) return "STEP_UP";
  if (result.consentRequired || result.hitlRequired) return "CONSENT";
  return result.decision || "INDETERMINATE";
}

const STATUS_GLYPH = { permit: "✓", deny: "✕", step_up: "!", consent: "!", set: "–", na: "N/A" };
const EFFECT_CLASS = (e) => (/DENY/.test(e || "") ? "deny" : "permit");

/**
 * Build the overlay: a Map of nodeId -> { kind, active, onPath, statements[] }.
 * - active : a RULE that matched a returned statement (decision-bearing).
 * - onPath : the node, or any descendant, is active (the green path).
 */
function buildOverlay(roots, statements) {
  const ov = new Map();
  const rules = [];
  const walk = (n) => {
    ov.set(n.id, { kind: n.kind === "RULE" ? ruleKind(n) : null, active: false, onPath: false, statements: [] });
    if (n.kind === "RULE") rules.push(n);
    (n.children || []).forEach(walk);
  };
  roots.forEach(walk);

  const unmatched = [];
  for (const stmt of statements) {
    const k = kindFromText(stmt.code) || kindFromText(stmt.name);
    const candidates = rules.filter((r) => ruleKind(r) === k);
    if (candidates.length === 0) {
      unmatched.push(stmt);
      continue;
    }
    // Tie-break same-kind rules by name-token overlap with the statement name.
    const stmtTokens = new Set(tokens(stmt.name));
    let best = candidates[0];
    let bestScore = -1;
    for (const r of candidates) {
      const score = tokens(r.name).reduce((acc, t) => acc + (stmtTokens.has(t) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    const o = ov.get(best.id);
    o.active = true;
    o.statements.push(stmt);
  }

  // Post-order: a node is on the path if it is active or any child is.
  const mark = (n) => {
    const o = ov.get(n.id);
    let path = o.active;
    (n.children || []).forEach((c) => { if (mark(c)) path = true; });
    o.onPath = path;
    return path;
  };
  roots.forEach(mark);

  return { ov, unmatched };
}

function NodeCard({ node, o }) {
  const isRule = node.kind === "RULE";
  let statusKind;
  if (isRule) statusKind = o.active ? o.kind || "permit" : "na";
  else statusKind = o.onPath ? "set" : "na";

  const kindLabel = { POLICY_SET: "Policy Set", POLICY: "Policy", RULE: "Rule" }[node.kind] || node.kind;
  const bubble = o.statements.length;

  return (
    <div className={`p1dt-card${o.onPath ? " is-path" : ""}${isRule && !o.active ? " is-na" : ""}`}>
      {bubble > 0 && <span className="p1dt-bubble" title="Statements returned for this rule">💬 {bubble}</span>}
      <div className="p1dt-card-top">
        <span className={`p1dt-status p1dt-status--${statusKind}`}>{STATUS_GLYPH[statusKind]}</span>
        <div className="p1dt-card-body">
          <div className="p1dt-kind">{kindLabel}</div>
          <div className="p1dt-name">{node.name}</div>
          {node.algorithm && <div className="p1dt-algo">{node.algorithm}</div>}
        </div>
      </div>
      <div className="p1dt-foot">
        {isRule && node.effect ? (
          <span className={`p1dt-effect p1dt-effect--${EFFECT_CLASS(node.effect)}`}>
            {node.effect.replace(/_/g, " ")}
          </span>
        ) : (
          <span />
        )}
        {isRule && <span className="p1dt-foot-timing">&lt;1 ms</span>}
      </div>
    </div>
  );
}

function Branch({ node, ov }) {
  const o = ov.get(node.id) || { onPath: false, active: false, statements: [] };
  const kids = node.children || [];
  return (
    <div className={`p1dt-branch${o.onPath ? " is-path" : ""}`}>
      <NodeCard node={node} o={o} />
      {kids.length > 0 && (
        <>
          <div className={`p1dt-link${o.onPath ? " is-path" : ""}`} />
          <div className={`p1dt-children${kids.length === 1 ? " p1dt-children--one" : ""}`}>
            {kids.map((c) => <Branch key={c.id} node={c} ov={ov} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default function PolicyDecisionTree({ policies, result }) {
  if (!result || !Array.isArray(policies) || policies.length === 0) return null;

  const raw = result.pingoneResponse || result.raw || {};
  const statements = Array.isArray(raw.statements) ? raw.statements : [];
  const decision = overallDecision(result);
  const us = typeof raw.elapsedMicroseconds === "number" ? raw.elapsedMicroseconds : null;
  const timing = us != null ? `${(us / 1000).toFixed(3)} ms` : null;

  const { ov, unmatched } = buildOverlay(policies, statements);

  return (
    <div className="p1dt">
      <div className="p1dt-head">
        <span className="p1dt-title">Policy decision trace</span>
        <span className={`p1dt-overall p1dt-overall--${decision.toLowerCase()}`}>{decision.replace(/_/g, " ")}</span>
        {timing && <span className="p1dt-timing">total {timing}</span>}
        <span className="p1dt-derived" title="PingOne's API returns the verdict + fired statements, not a per-node trace. Per-node badges are derived here.">
          derived from decision result
        </span>
      </div>

      <div className="p1dt-tree">
        {policies.map((root) => (
          <Branch key={root.id} node={root} ov={ov} />
        ))}
      </div>

      {statements.length > 0 && (
        <div className="p1dt-statements">
          <div className="p1dt-statements-title">Statements returned by PingOne ({statements.length})</div>
          {statements.map((s, i) => (
            <div className="p1dt-stmt" key={s.code || i}>
              <span>{s.name || "(unnamed)"}</span>
              {s.code && <code>{s.code}</code>}
              <span className={s.fulfilled ? "p1dt-stmt-fulfilled" : "p1dt-stmt-pending"}>
                {s.fulfilled ? "fulfilled" : s.obligatory ? "obligation pending" : "advice"}
              </span>
            </div>
          ))}
          {unmatched.length > 0 && (
            <div className="p1dt-stmt" style={{ color: "#b45309" }}>
              ⚠️ {unmatched.length} statement{unmatched.length !== 1 ? "s" : ""} could not be mapped to a rule node
              (shown above, not highlighted on the tree).
            </div>
          )}
        </div>
      )}

      <div className="p1dt-legend">
        <span className="p1dt-legend-item"><span className="p1dt-legend-dot" style={{ background: "#22c55e" }} /> Taken path / active rule</span>
        <span className="p1dt-legend-item"><span className="p1dt-legend-dot" style={{ background: "#e5e7eb" }} /> N/A (not applicable — derived)</span>
        <span className="p1dt-legend-item"><span className="p1dt-legend-dot" style={{ background: "#6366f1" }} /> Policy set / policy on path</span>
        <span className="p1dt-legend-item">💬 = statements mapped to that rule</span>
      </div>
    </div>
  );
}
