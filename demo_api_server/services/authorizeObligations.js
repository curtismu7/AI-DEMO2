/**
 * authorizeObligations.js
 *
 * Single source of truth for mapping a list of authorization obligations to the
 * three decision flags the BFF gates act on: { stepUpRequired, hitlRequired,
 * consentRequired }.
 *
 * Why this module exists (H2 fix): the obligation-type -> flag mapping used to
 * live in two places that silently disagreed —
 *   - pingOneAuthorizeService._extractStepUpRequired / _extractHitlRequired /
 *     _extractConsentRequired (regex over raw.obligations + raw.advice), where
 *     a `HITL_CONSENT` obligation matched BOTH the HITL and consent regexes; and
 *   - simulatedAuthorizeService, which emitted `STEP_UP` / `HITL` / `HITL_CONSENT`
 *     and set only one flag.
 * Same policy intent, different boolean tuples. Both engines now classify
 * through this one function so the mapping cannot drift.
 *
 * Contract (decided with the maintainer):
 *   - Input: a NORMALIZED array of obligation objects, each with a `type` or
 *     `id` string. Each engine is responsible for extracting/merging its own
 *     sources (PingOne merges raw.obligations + raw.advice + raw.details.*;
 *     simulated passes its flat obligations array). This module owns only the
 *     type -> flag mapping, which is the actual drift point.
 *   - Classification is MUTUALLY EXCLUSIVE per obligation, most-specific wins:
 *       HITL_CONSENT            -> consent   (NOT also hitl)
 *       HITL / HUMAN_APPROVAL   -> hitl
 *       STEP_UP                 -> stepUp
 *   - The returned flags enforce HIGHEST-GATE-WINS across the whole list:
 *       stepUp  >  hitl/consent  >  (none)
 *     (DENY is a top-level decision, not an obligation, so it never reaches
 *     this classifier — by the time obligations are evaluated the decision is
 *     non-DENY.) When step-up is present anywhere in the list, ONLY
 *     stepUpRequired is true even if HITL/consent obligations also appear.
 *   - `classified` (the per-obligation breakdown) is returned alongside the
 *     winning booleans for education/UI ("also had a consent obligation"); it
 *     is informational only and MUST NOT drive enforcement.
 *
 * @module services/authorizeObligations
 */

'use strict';

/** @typedef {{ type?: string, id?: string, [k: string]: unknown }} Obligation */

/**
 * Classify one obligation's type/id string into exactly one kind.
 * Most-specific match wins: HITL_CONSENT is checked before the generic HITL
 * pattern so a consent obligation is NOT also counted as plain HITL.
 *
 * @param {Obligation} ob
 * @returns {'stepUp'|'consent'|'hitl'|null}
 */
function classifyObligation(ob) {
  // Accept the identifier under type, id, OR code — PingOne Authorize returns
  // applied rule effects as `statements[].code` (e.g. 'step-up-required',
  // 'HITL', 'HITL_CONSENT'), while XACML-style obligations/advice use type/id.
  // Normalize away separators/case so hyphenated codes ('step-up-required')
  // match the same patterns as underscored types ('STEP_UP').
  const raw = String((ob && (ob.type || ob.id || ob.code)) || '').toUpperCase();
  if (!raw) return null;
  const key = raw.replace(/[^A-Z0-9]/g, '');
  // Order matters: HITL_CONSENT before HITL (most specific first).
  if (key.includes('HITLCONSENT')) return 'consent';
  if (key.includes('STEPUP')) return 'stepUp';
  if (key.includes('HITL') || key.includes('HUMANAPPROVAL')) return 'hitl';
  return null;
}

/**
 * Map a normalized obligation array to the three enforcement flags, applying
 * highest-gate-wins (stepUp > hitl/consent).
 *
 * @param {Obligation[]|null|undefined} obligations
 * @returns {{
 *   stepUpRequired: boolean,
 *   hitlRequired: boolean,
 *   consentRequired: boolean,
 *   classified: { stepUp: Obligation[], hitl: Obligation[], consent: Obligation[] }
 * }}
 */
function classifyObligations(obligations) {
  const classified = { stepUp: [], hitl: [], consent: [] };

  if (Array.isArray(obligations)) {
    for (const ob of obligations) {
      const kind = classifyObligation(ob);
      if (kind) classified[kind].push(ob);
    }
  }

  const hasStepUp = classified.stepUp.length > 0;
  const hasConsent = classified.consent.length > 0;
  const hasHitl = classified.hitl.length > 0;

  // Highest-gate-wins: step-up dominates. Only one enforcement flag is ever
  // true so callers cannot accidentally double-gate (the duplicated, drifting
  // precedence in transactionAuthorizationService is now centralized here).
  if (hasStepUp) {
    return { stepUpRequired: true, hitlRequired: false, consentRequired: false, classified };
  }
  if (hasConsent) {
    return { stepUpRequired: false, hitlRequired: false, consentRequired: true, classified };
  }
  if (hasHitl) {
    return { stepUpRequired: false, hitlRequired: true, consentRequired: false, classified };
  }
  return { stepUpRequired: false, hitlRequired: false, consentRequired: false, classified };
}

module.exports = {
  classifyObligation,
  classifyObligations,
};
