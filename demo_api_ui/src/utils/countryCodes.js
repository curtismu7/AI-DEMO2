/**
 * Shared country-code picker + phone-composition helper for SMS enrollment.
 *
 * Default is +1 (US/NANP) — this is a US demo tenant. The selected code is
 * prepended to the locally-entered national number before the E.164
 * normalization pass, so "9725231586" + "+1" and "+1 9725231586" and a full
 * "+15551234567" all produce the same E.164 result.
 */

export const COUNTRY_CODES = [
  { code: '1', label: 'US/CA +1' },
  { code: '44', label: 'UK +44' },
  { code: '49', label: 'DE +49' },
  { code: '33', label: 'FR +33' },
  { code: '81', label: 'JP +81' },
  { code: '82', label: 'KR +82' },
  { code: '86', label: 'CN +86' },
  { code: '91', label: 'IN +91' },
  { code: '61', label: 'AU +61' },
  { code: '55', label: 'BR +55' },
  { code: '52', label: 'MX +52' },
];

export const DEFAULT_COUNTRY_CODE = '1';

/**
 * Compose the E.164 number from a selected country code and the user's entry.
 * If the user already typed a leading "+" (full E.164), their input wins so
 * the picker never double-prepends.
 * @param {string} countryCode dial code without "+" (e.g. "1")
 * @param {string} nationalNumber raw input value
 * @returns {string} value ready for normalizePhoneE164
 */
export function composePhone(countryCode, nationalNumber) {
  const raw = String(nationalNumber || '').trim();
  if (!raw) return '';
  if (raw.startsWith('+')) return raw;
  return `+${countryCode || DEFAULT_COUNTRY_CODE}${raw}`;
}
