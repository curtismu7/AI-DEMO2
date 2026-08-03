'use strict';

/**
 * Obligation classification for PingOne Authorize decisions.
 *
 * The gateway used to read only the top-level `decision` field and treat
 * `INDETERMINATE` as "a human must approve". That works against the MOCK authz
 * server, which returns INDETERMINATE for step-up and consent — but it is not
 * what the real PDP does. A PingOne Authorize rule effect is either
 * `unconditionalPermit` or `conditionalDenyElsePermit`; neither can produce
 * INDETERMINATE. Live P1AZ returns `decision: PERMIT` with the applied rule
 * effects in `statements[]`, so a gateway that only reads the label FORWARDS a
 * call the PDP attached a consent obligation to.
 *
 * Real-first: classify the statements, exactly as the BFF's
 * demo_api_server/services/authorizeObligations.js does — same normalization
 * (strip separators, uppercase), same most-specific-first order, same
 * highest-gate-wins precedence. If these two drift, a live obligation silently
 * stops gating on one transport and not the other.
 */

export type ObligationKind = 'stepUp' | 'consent' | 'hitl';

/** A statement/obligation as it arrives on a decision response. */
export interface AuthorizeStatement {
  code?: string;
  name?: string;
  id?: string;
  type?: string;
}

/**
 * Classify one statement into exactly one kind. Order matters: HITL_CONSENT is
 * checked before the generic HITL pattern so a consent obligation is not also
 * counted as plain HITL.
 */
export function classifyStatement(st: AuthorizeStatement | string | null | undefined): ObligationKind | null {
  const raw = typeof st === 'string'
    ? st
    : String((st && (st.type || st.id || st.code || st.name)) || '');
  if (!raw) return null;
  const key = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!key) return null;
  if (key.includes('HITLCONSENT')) return 'consent';
  if (key.includes('STEPUP')) return 'stepUp';
  if (key.includes('HITL') || key.includes('HUMANAPPROVAL')) return 'hitl';
  return null;
}

/**
 * Reduce a statements array to the single gate that must be enforced.
 * Highest-gate-wins: step-up outranks consent/HITL, so a call over BOTH the
 * step-up and the consent threshold demos as step-up (matching the BFF).
 *
 * Returns null when no statement carries an obligation.
 */
export function classifyStatements(statements: unknown): ObligationKind | null {
  if (!Array.isArray(statements)) return null;
  const kinds = new Set<ObligationKind>();
  for (const st of statements) {
    const kind = classifyStatement(st as AuthorizeStatement);
    if (kind) kinds.add(kind);
  }
  if (kinds.has('stepUp')) return 'stepUp';
  if (kinds.has('consent')) return 'consent';
  if (kinds.has('hitl')) return 'hitl';
  return null;
}
