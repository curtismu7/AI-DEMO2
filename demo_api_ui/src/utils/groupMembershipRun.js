import apiClient from '../services/apiClient';
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { groupRequirementForUseCase } from './requiredDemoFlags';
import { restoreGroupMembership } from './restoreGroupMembership';

/**
 * Put the demo user in or out of a vertical's premiumTier group before its chip
 * fires. Extracted from UseCaseLauncherPage.handleRun so the sequence can be
 * tested without the 900-line page.
 *
 * Unlike feature-flag arming, this MUST block and MUST throw: the endpoint reads
 * membership back from PingOne precisely so a write that did nothing cannot
 * report success, and a chip fired against unverified membership produces a
 * verdict that proves nothing.
 *
 * @param {object} uc catalog entry
 * @param {string} vertical vertical the run targets — NOT the active one. The
 *   route falls back to the session's active vertical when this is missing, and
 *   running UC9 for Super Sports from banking then stripped Banking_PremiumTier
 *   and left the sporting-goods group intact, so the chip PERMITted.
 * @returns {Promise<'in'|'out'|null>} the requirement armed, or null if none
 */
export async function armGroupMembership(uc, vertical) {
  const groupReq = groupRequirementForUseCase(uc);
  if (!groupReq) return null;
  const wantIn = groupReq === 'in';
  try {
    const { data } = await apiClient.post(
      '/api/groups/membership/toggle',
      { inGroup: wantIn, category: 'premiumTier', verticalId: vertical },
      { _noAuthBanner: true },
    );
    if (data?.verified !== true || data?.inGroup !== wantIn) {
      throw new Error(`membership not verified (wanted inGroup=${wantIn}, got ${data?.inGroup})`);
    }
  } catch (e) {
    throw new Error(e?.response?.data?.message || e.message);
  }
  return groupReq;
}

/**
 * Restore premiumTier once THIS run's chip reaches a terminal verdict.
 *
 * Restore used to fire in the `.then` of /api/use-cases/demo/run, which only
 * RETURNS the trigger text — the chip is dispatched later, by AIAgent, after the
 * launcher navigates. So the user went back INTO the group while UC9's chip was
 * still in flight and UC9 raced its declared DENY_403 to a false PERMIT.
 *
 * The terminal signal is the trace store's `outcome`, the same emit
 * ProofOfEnforcementContext scores its verdict from. Fires once, for the first
 * run that starts after this call — the current run's id is captured up front so
 * an already-settled prior trace cannot satisfy it.
 *
 * ponytail: if the chip is never dispatched (the visitor navigates away), the
 * listener sits idle for the rest of the page's life and the logout backstop in
 * demo_api_server/services/groupMembershipLogoutRestore.js does the restoring.
 *
 * @param {string} verticalId vertical whose membership was armed
 * @returns {() => void} unsubscribe, for a caller that wants to cancel
 */
export function restoreGroupMembershipAfterRun(verticalId) {
  const armedRunId = tokenChainTraceStore.getState().trace.runId;
  let done = false;
  const unsubscribe = tokenChainTraceStore.subscribe(({ trace }) => {
    if (done || !trace.outcome || trace.runId == null || trace.runId === armedRunId) return;
    done = true;
    // Deferred: subscribe() calls back synchronously, so `unsubscribe` may not
    // be bound yet on the very first emit.
    queueMicrotask(() => unsubscribe());
    restoreGroupMembership(verticalId);
  });
  return unsubscribe;
}

/**
 * Flip ff_authorize_group_policy back OFF once THIS run reaches a terminal
 * verdict — the flag side of the group demo. The launcher and AIAgent arm the
 * flag ON at run start (requiredFlagsForUseCase → PATCH); without this the
 * demo leaves the authorization surface changed behind it, and a later UC6
 * (amount-ceiling deny) would also carry a group rule it does not declare.
 *
 * Same terminal-signal shape as restoreGroupMembershipAfterRun: the trace
 * store's outcome, one run after this call, fired once.
 *
 * ponytail: if the chip is never dispatched the listener sits idle for the
 * page's life; flipping the flag off in Demo Config is the manual backstop.
 *
 * @returns {() => void} unsubscribe, for a caller that wants to cancel
 */
export function restoreGroupPolicyFlagAfterRun() {
  const armedRunId = tokenChainTraceStore.getState().trace.runId;
  let done = false;
  const unsubscribe = tokenChainTraceStore.subscribe(({ trace }) => {
    if (done || !trace.outcome || trace.runId == null || trace.runId === armedRunId) return;
    done = true;
    queueMicrotask(() => unsubscribe());
    // _noAuthBanner: a 401 here says nothing about the session — the arming
    // PATCH already established it had one.
    apiClient.patch(
      '/api/admin/feature-flags',
      { updates: { ff_authorize_group_policy: false } },
      { _noAuthBanner: true },
    ).catch(() => { /* best effort — Demo Config is the manual backstop */ });
  });
  return unsubscribe;
}
