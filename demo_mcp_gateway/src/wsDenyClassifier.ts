'use strict';

/**
 * wsDenyClassifier.ts — pure disposition classifier for the WS transport's
 * tools/call DENY handling (index.ts handleMessage).
 *
 * index.ts binds a real WebSocket listener at import time, so its inline deny
 * branches cannot be unit-tested directly. This module holds the ordering
 * decision — the exact thing bug #66 got wrong — as a pure function so the
 * "a step-up decision must NOT collapse to insufficient_scope" contract is
 * covered by a scoped test.
 *
 * Elicitation is handled by an earlier inline branch in index.ts (it returns
 * before this runs), so it is intentionally not a disposition here.
 */

import { isPolicyNotFoundReason } from './pingAuthorizeGuard';

export type WsDenyDisposition = 'stepup' | 'hitl' | 'policy_not_found' | 'insufficient_scope';

/**
 * Decide how a non-permitted, non-elicitation authz decision should be surfaced
 * over the WS transport. Order matters: step-up (MFA) outranks HITL/consent,
 * which outranks policy-drift, which outranks the generic insufficient_scope.
 */
export function classifyWsDeny(
  authz: { obligation?: string; reason?: string },
  hitlApproved: boolean,
): WsDenyDisposition {
  // Step-up is MFA, not a human/consent ask — it gets its own signal so the
  // agent drives re-authentication instead of chasing token scopes forever.
  if (authz.obligation === 'stepUp' && !hitlApproved) return 'stepup';
  if (authz.reason === 'HITL_REQUIRED') return 'hitl';
  if (isPolicyNotFoundReason(authz.reason)) return 'policy_not_found';
  return 'insufficient_scope';
}
