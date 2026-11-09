'use strict';

/**
 * Mock PingOne user records for the mock decision engine, keyed by token subject.
 *
 * In PingOne Authorize the Trust Framework attribute MemberTier is READ FROM THE PINGONE USER's
 * custom attribute airlineMemberTier (keyed on UserId, the token sub). It is never supplied by the
 * caller or by PingGateway. The mock mirrors that: Rule 3-airline asks this store, not the request.
 * A subject with no record, or a record with an empty/missing airlineMemberTier, has no tier, which
 * is NOT premium (fail closed). Same attribute name as the tenant's user schema.
 */

const records = new Map(); // sub -> { airlineMemberTier }

/** Set (or replace) the mock user record for a subject. */
function setMockUser(sub, record) {
  if (!sub || typeof sub !== 'string') throw new Error('setMockUser needs a non-empty subject');
  records.set(sub, { ...(record || {}) });
}

/** The airlineMemberTier of a subject: '' when there is no record or no value. */
function getAirlineMemberTier(sub) {
  const v = records.get(String(sub || ''))?.airlineMemberTier;
  return typeof v === 'string' ? v : '';
}

function clearMockUsers() { records.clear(); }

module.exports = { setMockUser, getAirlineMemberTier, clearMockUsers };
