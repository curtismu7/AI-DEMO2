// demo_api_ui/src/pages/privilegePiiScan.js
//
// The scanner behind the Personal data detection page, extracted so the unit
// test exercises exactly what the page runs. Checksummed kinds claim their
// spans first: a generic pattern (phone) never double-reports digits a
// checksum-validated kind already identified.

import { PII_KINDS } from '../config/privilegePiiKinds';

/** Deterministic AIGuard-style outcome per kind, mirroring the graduated
 *  response: national identifiers + payment cards block, financial alert,
 *  contact details sanitize, everything else allow-with-record. */
export function outcomeFor(kind) {
  if (kind.group === 'National identifiers') return 'block';
  if (kind.group === 'Financial') return 'alert';
  return 'sanitize';
}

export function scan(text, enabledKinds = PII_KINDS) {
  const findings = [];
  for (const kind of enabledKinds) {
    const re = new RegExp(kind.pattern.source, kind.pattern.flags.includes('g') ? kind.pattern.flags : `${kind.pattern.flags}g`);
    let m;
    while ((m = re.exec(text)) !== null) {
      const value = m[0].trim();
      if (!value) continue;
      if (kind.validate && !kind.validate(value)) continue; // checksum gate: not reported
      findings.push({ kindId: kind.id, kindLabel: kind.label, group: kind.group, value, outcome: outcomeFor(kind), start: m.index, end: m.index + value.length, checksummed: Boolean(kind.checksum) });
    }
  }
  const claimed = findings.filter((f) => f.checksummed);
  return findings.filter((f) => f.checksummed || !claimed.some((c) => c !== f && c.start <= f.start && f.end <= c.end));
}

export function annotate(text, findings) {
  if (!findings.length) return [{ text, kindLabel: null }];
  const sorted = [...findings].sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const f of sorted) {
    if (f.start < cursor) continue; // overlapping earlier match wins
    if (f.start > cursor) parts.push({ text: text.slice(cursor, f.start), kindLabel: null });
    parts.push({ text: text.slice(f.start, f.end), kindLabel: f.kindLabel, outcome: f.outcome });
    cursor = f.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), kindLabel: null });
  return parts;
}
