/**
 * @file pauseObligation.js
 * Does an Authorize evaluation carry a PAUSE obligation (step-up / consent /
 * human approval / elicitation)?
 *
 * Phase 3c of docs/superpowers/plans/2026-08-18-indeterminate-rework.md.
 *
 * WHY THIS EXISTS
 * ---------------
 * The token-chain trace decided "is this a challenge?" from the DECISION value
 * alone (`decision === "INDETERMINATE" | "STEP_UP" | "HITL_REQUIRED"`). Phase 4
 * stops the PDP emitting INDETERMINATE for a pause — the obligation becomes the
 * signal — at which point every one of those checks silently goes false and a
 * step-up renders as a hard DENY. UC7/UC8 are REGRESSION_PLAN §1, so the trace
 * has to read the obligation BEFORE the flip, not after it.
 *
 * Obligation-first with the legacy decision values as fallback is the same
 * migration shape the Node gateway used in phase 3a (#2129) and the Groovy
 * classifier in #2133: explicit obligations win, the old signal keeps working
 * until it is gone.
 *
 * ⚠️ FOURTH COPY OF THIS VOCABULARY. The others:
 *     demo_api_server/services/authorizeObligations.js   (BFF)
 *     demo_mcp_gateway/src/auth/authorizeObligations.ts  (Node gateway)
 *     ping-gateway/scripts/groovy/p1az-decision.groovy   (IG)
 * They have drifted twice already — the Groovy one had no ELICITATION (#2133,
 * a real ungated destructive call) and the BFF one could not read `name`
 * (#2137, gated on one path and not the other). This copy exists because the
 * browser cannot require the CommonJS BFF module; the identifier fields and
 * kind patterns below are deliberately identical to those three, and
 * `pauseObligation.test.js` pins them so a future divergence fails a test
 * rather than a demo. If a served classification ever becomes available,
 * delete this file and read that instead.
 */

/** Identifier fields, in the same precedence the other three classifiers use. */
function identifierOf(ob) {
  if (!ob || typeof ob !== "object") return "";
  return String(ob.type || ob.id || ob.code || ob.name || "");
}

/**
 * Classify one obligation into a pause kind, or null.
 * Order matters: HITL_CONSENT before the generic HITL, exactly as the BFF and
 * gateway classifiers do, so a consent obligation is not also counted as HITL.
 *
 * @param {object} ob
 * @returns {'stepUp'|'consent'|'hitl'|'elicitation'|null}
 */
export function classifyPauseObligation(ob) {
  const key = identifierOf(ob).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!key) return null;
  if (key.includes("HITLCONSENT")) return "consent";
  if (key.includes("STEPUP")) return "stepUp";
  if (key.includes("ELICITATION")) return "elicitation";
  if (key.includes("HITL") || key.includes("HUMANAPPROVAL")) return "hitl";
  return null;
}

/**
 * The pause kind carried by an Authorize evaluation, or null.
 *
 * Looks wherever the trace actually carries a decision payload — the evaluation
 * itself, its `response`, or its `raw` — because the single-decision path is fed
 * a rich `azEval` while the multi-decision path is fed raw entries off
 * `trace.authorizeEvaluations`, and only some of those preserve the response
 * body. `statements` is read alongside `obligations` since PingOne returns
 * applied rule effects there (`statements[].code`).
 *
 * @param {object|null|undefined} evalObj
 * @returns {'stepUp'|'consent'|'hitl'|'elicitation'|null}
 */
export function pauseObligationKind(evalObj) {
  if (!evalObj || typeof evalObj !== "object") return null;
  const sources = [evalObj, evalObj.response, evalObj.raw];
  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const lists = [src.obligations, src.advice, src.statements, src.details && src.details.obligations];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      for (const ob of list) {
        const kind = classifyPauseObligation(ob);
        if (kind) return kind;
      }
    }
  }
  return null;
}

/**
 * True when this evaluation is a pause, by EITHER signal.
 *
 * `decision` is passed already upper-cased by the callers. The legacy values
 * stay until phase 4 removes them from the wire; after that only the obligation
 * fires, and this function keeps the same answer either way — which is the
 * whole point of migrating the reader before flipping the writer.
 *
 * @param {string} decision
 * @param {object|null|undefined} evalObj
 */
export function isPause(decision, evalObj) {
  if (pauseObligationKind(evalObj)) return true;
  return decision === "INDETERMINATE" || decision === "STEP_UP" || decision === "HITL_REQUIRED";
}
