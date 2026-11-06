// demo_api_ui/src/config/privilegePiiKinds.js
//
// The PII kind catalog for the Personal Data demo (Platform Update, page 13):
// coverage went from 5 kinds to 23, each numeric kind checksum-validated, and
// the same rules run on LLM, MCP, A2A and coding-agent traffic alike.
//
// This page's detectors run in the browser and are a faithful subset of the
// documented behaviour: for each kind the page states its pattern and, where
// the platform checksum-validates, implements that checksum. Sample values are
// syntactically valid test fixtures, not real identifiers.

/** Luhn checksum (credit cards, and the base for SIN validation). */
export function luhnValid(digits) {
  const s = String(digits).replace(/\D/g, '');
  if (!s) return false;
  let sum = 0;
  let dbl = false;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    let d = s.charCodeAt(i) - 48;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Mod-11 style weighting used by Canada SIN (Luhn over 9 digits). */
const sinValid = (v) => /^\d{3}[ ]?\d{3}[ ]?\d{3}$/.test(v) && luhnValid(v.replace(/\s/g, ''));

/** India Aadhaar: 12 digits, last digit = Verhoeff checksum over first 11. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
function verhoeffCheck(digits) {
  let c = 0;
  const rev = digits.split('').reverse();
  rev.forEach((d, i) => { c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][Number(d)]]; });
  return c === 0;
}
const aadhaarValid = (v) => /^[2-9]\d{3}[ ]?\d{4}[ ]?\d{4}$/.test(v) && verhoeffCheck(v.replace(/\s/g, ''));

/** India PAN: five letters, four digits, one letter. */
const panValid = (v) => /^[A-Z]{5}\d{4}[A-Z]$/.test(v.toUpperCase().replace(/\s/g, ''));

/** Australia TFN: 8–9 digits, weighted mod-11. */
const tfnValid = (v) => {
  const s = v.replace(/\s/g, '');
  if (!/^\d{8,9}$/.test(s)) return false;
  const weights = s.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [2, 7, 6, 5, 4, 3, 2, 1];
  const sum = s.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  return sum % 11 === 0;
};

/** New Zealand IRD: 8–11 digits, base modulus 11 with two known weight tables. */
const irdValid = (v) => {
  const s = v.replace(/\s/g, '');
  if (!/^\d{8,11}$/.test(s)) return false;
  const padded = s.padStart(11, '0').split('').map(Number);
  const primary = [3, 2, 7, 6, 5, 4, 3, 2];
  for (const w of [primary, [7, 4, 3, 2, 5, 2, 7, 6]]) {
    const tail = padded.slice(-8);
    const sum = tail.reduce((acc, d, i) => acc + d * w[i], 0);
    const rem = sum % 11;
    if (rem === 0) return true;
    const check = 11 - rem;
    if (check === 10) continue; // try the secondary weight table
    if (check === tail[7]) return true;
  }
  return false;
};

/** UK NINO: two letters, six digits, optional final letter A–D. */
const ninoValid = (v) => /^[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]?$/.test(v.toUpperCase().trim());

/**
 * The kinds. `pattern` drives highlight; `validate`, when present, is the
 * checksum gate the platform applies (numeric kinds are checksum-validated).
 * Sample values in fixtures are valid under both.
 */
export const PII_KINDS = [
  { id: 'uk-nino', label: 'UK NINO', group: 'National identifiers', pattern: /[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]?/g, validate: ninoValid, checksum: true },
  { id: 'india-aadhaar', label: 'India Aadhaar', group: 'National identifiers', pattern: /[2-9]\d{3}\s?\d{4}\s?\d{4}/g, validate: aadhaarValid, checksum: true },
  { id: 'india-pan', label: 'India PAN', group: 'National identifiers', pattern: /[A-Za-z]{5}\d{4}[A-Za-z]/g, validate: panValid, checksum: true },
  { id: 'canada-sin', label: 'Canada SIN', group: 'National identifiers', pattern: /\d{3}[ ]?\d{3}[ ]?\d{3}/g, validate: sinValid, checksum: true },
  { id: 'australia-tfn', label: 'Australia TFN', group: 'National identifiers', pattern: /\d{3}\s?\d{3}\s?\d{2,3}/g, validate: tfnValid, checksum: true },
  { id: 'nz-ird', label: 'New Zealand IRD', group: 'National identifiers', pattern: /\d{2,3}\s?\d{3}\s?\d{3}/g, validate: irdValid, checksum: true },
  { id: 'credit-card', label: 'Payment card (PAN)', group: 'Financial', pattern: /\b(?:\d[ -]?){13,19}\b/g, validate: luhnValid, checksum: true },
  { id: 'iban', label: 'IBAN', group: 'Financial', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g, checksum: false },
  { id: 'us-ssn', label: 'US SSN', group: 'National identifiers', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, checksum: false },
  { id: 'email', label: 'Email address', group: 'Contact details', pattern: /[\w.+-]+@[\w-]+\.[\w.]+/g, checksum: false },
  { id: 'phone', label: 'Phone number', group: 'Contact details', pattern: /\+?\d[\d ()-]{8,}\d/g, checksum: false },
];

/** Fixture prompts the page scans. Each kind above appears at least once,
 *  and one candidate per kind is checksum-INVALID to show the gate working. */
export const PII_SAMPLES = [
  {
    key: 'support-ticket',
    label: 'Support ticket paste',
    text: 'Customer Dana Fox, SIN 046 454 286, email dana.fox@example.com, card 4539 1488 0343 6467, phone +1 415 555 0132. Follow up Tuesday.',
  },
  {
    key: 'onboarding-doc',
    label: 'Onboarding document',
    text: 'New starter: NINO QQ 12 34 56 A, PAN ABCDE1234F, Aadhaar 2345 6789 0125. Bank IBAN GB29 NWBK 6016 1331 9268 19.',
  },
  {
    key: 'checksum-fail',
    label: 'Checksum-invalid digits',
    text: 'Candidate values from the import file: SIN 046 454 287, Aadhaar 2345 6789 0126, TFN 123 456 783 — most fail their checksum and are not reported.',
  },
  {
    key: 'no-pii',
    label: 'Clean prompt',
    text: 'Summarise the Q3 reconciliation policy and list the open exceptions from the ledger.',
  },
];

export const PII_DEMO_NOTES = {
  ownFormats: 'Your own formats paste in unchanged in gitleaks rule format; the same rules run on LLM, MCP, A2A and coding-agent traffic.',
  graduated: 'Policy decides the outcome per kind: allow, alert, sanitize (redact the span and forward the rest) or block — thresholds overridable per key or per application.',
};
