/**
 * Shared helpers for inline MFA device enrollment (SMS / email / passkey).
 *
 * Used by both OtpStepUpModal.js (agent step-up) and TransactionConsentModal.tsx
 * (HITL transfer consent) so the two step-up surfaces cannot drift the way they
 * already did once in this repo's history: one gained a working device picker
 * and enrollment, the other silently kept a single OTP field for months because
 * nothing forced them to share logic.
 */

/**
 * Normalize user-entered phone to E.164 (default US +1 for 10-digit numbers).
 * @param {string} raw
 * @returns {string}
 */
export function normalizePhoneE164(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/**
 * Human-readable explanation for a passkey registration failure.
 *
 * WebAuthn surfaces an rp.id mismatch as a generic browser error with no
 * PingOne-specific detail, so this diagnoses the common case: PingOne rejects
 * any FIDO2 relying-party id whose TLD isn't public, which makes passkeys
 * permanently unavailable on hosts like api.ping.demo or localhost regardless
 * of restarts — see FIDO2_RP_ID in demo_api_server/.env.example.
 *
 * @param {Error & {name?: string, message?: string}} err
 * @returns {string}
 */
export function describePasskeyRegistrationError(err) {
  const detail = err?.name && err.name !== 'Error'
    ? `${err.name}: ${err.message || ''}`.trim()
    : (err?.message || String(err));
  const isRpId = /rp\.?id|relying party|registrable domain/i.test(detail);
  if (!isRpId) return `Passkey registration failed — ${detail}`;

  const host = (typeof window !== 'undefined' && window.location?.hostname) || 'this site';
  const tld = host.includes('.') ? host.split('.').pop().toLowerCase() : '';
  const hostRejectedByPingOne =
    !tld || ['demo', 'local', 'localhost', 'test', 'invalid', 'internal'].includes(tld);

  return hostRejectedByPingOne
    ? `Passkeys can't be used on "${host}". PingOne's FIDO2 policy "Relying Party ID" must match this host, but PingOne rejects a Relying Party ID whose TLD isn't public — so "${host}" cannot be set and restarting the API server will not fix it. Demo passkeys on the public-domain deployment, or step up with email/SMS on this host. (${detail})`
    : `Passkey isn't set up for this domain yet. PingOne's FIDO2 policy "Relying Party ID" must be "${host}". An admin can fix it in PingOne (MFA → FIDO Policy → Relying Party ID → Other → ${host}), or restart the API server to auto-configure it. (${detail})`;
}
