'use strict';

const crypto  = require('crypto');
const axios   = require('axios');
const configStore = require('./configStore');
const { logEvent: logAppEvent } = require('./appEventService');
const { getManagementToken } = require('./pingOneClientService');
const { fetchPingOneUserByUsername } = require('./pingOneUserLookupService');
const { fetchFirstPopulationId } = require('./pingoneBootstrapService');
const { DEMO_PASSWORD } = require('./pingoneProvisionService');

// ---------------------------------------------------------------------------
// Storage — LMDB
// ---------------------------------------------------------------------------

const VALID_SCOPES = [
  'view_accounts',
  'view_balances',
  'create_deposit',
  'create_withdrawal',
  'create_transfer',
];

const { getDb } = require('./lmdb/openEnv');
const pingOneUserService = require('./pingOneUserService');

function _db() { return getDb('delegations'); }

/**
 * Sync the grantor's PingOne `delegatedTo` attribute from the CURRENT active
 * delegation records (source of truth — avoids read-modify-write races). Best-effort:
 * never throws, so it can't fail a grant/revoke. The re-issued token then carries
 * `delegated_to` (rendered as its own lane in the token chain).
 * @param {string} delegatorUserId
 */
async function _syncGrantorDelegatedTo(delegatorUserId) {
  try {
    const subs = [];
    for (const { value } of _db().getRange()) {
      if (value && value.delegator_user_id === delegatorUserId && value.status === 'active' && value.delegate_user_id) {
        subs.push(value.delegate_user_id);
      }
    }
    pingOneUserService.initialize();
    await pingOneUserService.setDelegatedToAttribute(delegatorUserId, subs);
  } catch (err) {
    console.warn(`[delegationService] delegatedTo sync failed for ${delegatorUserId}: ${err.message}`);
  }
}

function toRecord(row) {
  if (!row) return null;
  return {
    ...row,
    scopes: Array.isArray(row.scopes) ? row.scopes : (typeof row.scopes === 'string' ? JSON.parse(row.scopes) : []),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _sendDelegationEmail(delegateUserId, type, delegatorEmail) {
  if (!delegateUserId) return;
  try {
    const token  = await getManagementToken();
    const envId  = configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '';
    const region = configStore.getEffective('PINGONE_REGION') || 'com';
    if (!envId) return;

    const subject = type === 'grant'
      ? 'Super Banking \u2014 You have been granted account access'
      : 'Super Banking \u2014 Account access revoked';

    const body = type === 'grant'
      ? `<html><body style="font-family:sans-serif;background:#f9fafb;padding:32px">
          <div style="max-width:480px;margin:auto;background:#fff;border-radius:10px;padding:32px;border:1px solid #e5e7eb">
            <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:8px;padding:20px 24px;margin-bottom:24px">
              <h2 style="color:#fff;margin:0;font-size:20px">Super Banking</h2>
            </div>
            <h3 style="color:#1e40af">Account Access Granted</h3>
            <p style="color:#374151">${delegatorEmail || 'A Super Banking user'} has granted you access to their accounts.</p>
            <p style="color:#374151">Log in to Super Banking to view the delegated accounts.</p>
          </div>
        </body></html>`
      : `<html><body style="font-family:sans-serif;background:#f9fafb;padding:32px">
          <div style="max-width:480px;margin:auto;background:#fff;border-radius:10px;padding:32px;border:1px solid #e5e7eb">
            <div style="background:linear-gradient(135deg,#1e40af,#3b82f6);border-radius:8px;padding:20px 24px;margin-bottom:24px">
              <h2 style="color:#fff;margin:0;font-size:20px">Super Banking</h2>
            </div>
            <h3 style="color:#dc2626">Account Access Revoked</h3>
            <p style="color:#374151">Your access to ${delegatorEmail ? `${delegatorEmail}'s` : "the delegated"} accounts has been revoked.</p>
          </div>
        </body></html>`;

    await axios.post(
      `https://api.pingone.${region}/v1/environments/${envId}/users/${delegateUserId}/messages`,
      { content: [{ deliveryMethod: 'Email', subject, body, charset: 'UTF-8' }] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 10000 },
    );
  } catch (err) {
    console.error('[delegationService] email send failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// grantDelegation
// ---------------------------------------------------------------------------

async function grantDelegation({ delegatorUserId, delegatorEmail, delegateEmail, scopes }) {
  // Validate input
  if (!delegateEmail) {
    return { ok: false, error: 'validation_error', message: 'delegateEmail is required.' };
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { ok: false, error: 'validation_error', message: 'At least one scope is required.' };
  }
  const invalidScopes = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (invalidScopes.length > 0) {
    return { ok: false, error: 'validation_error', message: `Invalid scopes: ${invalidScopes.join(', ')}` };
  }

  // Prevent self-delegation
  if (delegatorEmail && delegatorEmail.toLowerCase() === delegateEmail.toLowerCase()) {
    return { ok: false, error: 'self_delegation', message: 'Cannot delegate to yourself.' };
  }

  // Prevent duplicate active delegation
  for (const { value: rec } of _db().getRange()) {
    if (rec.delegator_user_id === delegatorUserId &&
        rec.delegate_email.toLowerCase() === delegateEmail.toLowerCase() &&
        rec.status === 'active') {
      return { ok: false, error: 'duplicate_delegation', message: 'Active delegation already exists for this email.' };
    }
  }

  // Look up delegate in PingOne
  let delegateUserId = null;
  let credentials = null;
  let credentialsWarning = null;
  const { user: existingUser } = await fetchPingOneUserByUsername(delegateEmail).catch(() => ({ user: null }));

  if (existingUser) {
    delegateUserId = existingUser.id;
  } else {
    // Provision new user via Management API
    try {
      const token   = await getManagementToken();
      const envId   = configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '';
      const region  = configStore.getEffective('PINGONE_REGION') || 'com';
      const apiRoot = `https://api.pingone.${region}/v1/environments/${envId}`;
      const popId   = await fetchFirstPopulationId(token, apiRoot);

      const userRes = await axios.post(
        `${apiRoot}/users`,
        {
          email: delegateEmail,
          username: delegateEmail,
          name: { given: 'Family', family: 'Member' },
          population: { id: popId },
          lifecycle: { status: 'ACCOUNT_OK' },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      );
      delegateUserId = userRes.data.id;

      // SECURITY: demo-only flow. We set a known demo password on the newly
      // created delegate and return it in the API response so the presenter
      // can log in as the delegate. Returning a password from an API is
      // acceptable ONLY in this demo — never do this in production.
      try {
        pingOneUserService.initialize();
        await pingOneUserService.setUserPassword(delegateUserId, DEMO_PASSWORD);
        credentials = { email: delegateEmail, password: DEMO_PASSWORD, note: 'newly created user' };
      } catch (pwErr) {
        console.warn(`[delegationService] password set failed for new delegate ${delegateEmail}: ${pwErr.message}`);
        credentialsWarning = 'Delegate user was created but setting their password failed — the delegation is still active.';
      }
    } catch (err) {
      // When management credentials are not configured, store the delegation
      // locally without a PingOne user ID so the demo still works.
      if (err.message && err.message.includes('not configured')) {
        console.warn('[delegationService] Management credentials not configured — storing delegation without PingOne user provisioning');
        // delegateUserId remains null; delegation is stored locally
      } else {
        logAppEvent('auth_lifecycle', 'warning', 'Delegation grant failed — PingOne provisioning error',
          { tag: 'delegation/grant-provisioning-failed', metadata: { delegatorUserId, delegateEmail, scopeCount: (scopes || []).length } }
        );
        return {
          ok: false,
          error: 'provisioning_failed',
          message: err.response?.data?.message || err.message,
        };
      }
    }
  }

  // Build record
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    delegator_user_id: delegatorUserId,
    delegator_email: delegatorEmail || '',
    delegate_email: delegateEmail.toLowerCase(),
    delegate_user_id: delegateUserId,
    scopes,
    status: 'active',
    granted_at: now,
    revoked_at: null,
  };

  _db().putSync(record.id, record);

  // Send grant email (best-effort, non-blocking)
  setImmediate(() =>
    _sendDelegationEmail(delegateUserId, 'grant', delegatorEmail).catch(() => {})
  );

  logAppEvent('auth_lifecycle', 'info', `Delegation granted: ${delegatorEmail} → ${delegateEmail}`,
    { tag: 'delegation/grant-success', metadata: { delegationId: record.id, delegatorUserId, delegateEmail, scopeCount: (scopes || []).length } }
  );
  await _syncGrantorDelegatedTo(delegatorUserId);
  return {
    ok: true,
    delegation: toRecord(record),
    reauthRequired: true,
    ...(credentials ? { credentials } : {}),
    ...(credentialsWarning ? { warning: credentialsWarning } : {}),
  };
}

// ---------------------------------------------------------------------------
// revokeDelegation
// ---------------------------------------------------------------------------

async function revokeDelegation(id, delegatorUserId) {
  const now = new Date().toISOString();
  const rec = _db().get(id);
  if (!rec || rec.delegator_user_id !== delegatorUserId || rec.status === 'revoked') {
    logAppEvent('auth_lifecycle', 'warning', 'Delegation revoke failed — not found or already revoked',
      { tag: 'delegation/revoke-not-found', metadata: { delegationId: id, delegatorUserId } }
    );
    return { ok: false, error: 'not_found' };
  }
  _db().putSync(id, { ...rec, status: 'revoked', revoked_at: now });
  setImmediate(() =>
    _sendDelegationEmail(rec.delegate_user_id, 'revoke', rec.delegator_email).catch(() => {})
  );

  logAppEvent('auth_lifecycle', 'info', `Delegation revoked: id=${id}`,
    { tag: 'delegation/revoke-success', metadata: { delegationId: id, delegatorUserId } }
  );
  await _syncGrantorDelegatedTo(delegatorUserId);
  return { ok: true, reauthRequired: true };
}

// ---------------------------------------------------------------------------
// listDelegations
// ---------------------------------------------------------------------------

async function listDelegations(delegatorUserId) {
  const result = [];
  for (const { value } of _db().getRange()) {
    if (value.delegator_user_id === delegatorUserId && value.status === 'active') {
      result.push(toRecord(value));
    }
  }
  return result.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

// ---------------------------------------------------------------------------
// getDelegationHistory
// ---------------------------------------------------------------------------

async function getDelegationHistory(delegatorUserId) {
  const result = [];
  for (const { value } of _db().getRange()) {
    if (value.delegator_user_id === delegatorUserId) result.push(toRecord(value));
  }
  return result.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

// ---------------------------------------------------------------------------
// getDelegationsGrantedToMe — delegations where I am the delegate
// ---------------------------------------------------------------------------

async function getDelegationsGrantedToMe(delegateEmail) {
  const normalised = delegateEmail.toLowerCase();
  const results = [];
  for (const { value } of _db().getRange()) {
    const rec = toRecord(value);
    if (rec && rec.delegate_email === normalised && rec.status === 'active') {
      results.push(rec);
    }
  }
  return results.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

// ---------------------------------------------------------------------------
// listAllDelegations (admin)
// ---------------------------------------------------------------------------

async function listAllDelegations({ status } = {}) {
  const result = [];
  for (const { value } of _db().getRange()) {
    if (!status || status === 'all' || value.status === status) result.push(toRecord(value));
  }
  return result.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}

// ---------------------------------------------------------------------------
// adminRevokeDelegation — revoke any delegation without ownership check
// ---------------------------------------------------------------------------

async function adminRevokeDelegation(id) {
  const now = new Date().toISOString();
  const rec = _db().get(id);
  if (!rec || rec.status === 'revoked') {
    return { ok: false, error: 'not_found' };
  }
  _db().putSync(id, { ...rec, status: 'revoked', revoked_at: now });
  setImmediate(() => _sendDelegationEmail(rec.delegate_user_id, 'revoke', rec.delegator_email).catch(() => {}));

  logAppEvent('auth_lifecycle', 'info', `Admin delegation revoke: id=${id}`,
    { tag: 'delegation/admin-revoke', metadata: { delegationId: id } }
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// adminGrantDelegation — grant on behalf of a delegator by email
// ---------------------------------------------------------------------------

async function adminGrantDelegation({ delegatorEmail, delegateEmail, scopes }) {
  if (!delegatorEmail) {
    return { ok: false, error: 'validation_error', message: 'delegatorEmail is required.' };
  }
  const { user: delegatorUser } = await fetchPingOneUserByUsername(delegatorEmail).catch(() => ({ user: null }));
  const delegatorUserId = delegatorUser?.id || `admin-${delegatorEmail}`;
  return grantDelegation({ delegatorUserId, delegatorEmail, delegateEmail, scopes });
}

module.exports = { grantDelegation, revokeDelegation, listDelegations, getDelegationHistory, getDelegationsGrantedToMe, listAllDelegations, adminRevokeDelegation, adminGrantDelegation };
