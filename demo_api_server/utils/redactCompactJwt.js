'use strict';

// A dotted value is a JWT candidate only when its first two base64url segments
// decode to a JOSE header and a JWT claims object. Header scanning also checks
// suffixes, so a token embedded directly after a word character is found.
const MAX_HEADER_SEGMENT_LENGTH = 4096;

function decodeJsonObject(segment) {
  if (!segment || segment.length % 4 === 1 || !'eICD'.includes(segment[0])) return null;
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) return null;
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isCompactJwt(headerSegment, payloadSegment) {
  const header = decodeJsonObject(headerSegment);
  if (!header || typeof header.alg !== 'string' || !header.alg) return false;
  return Boolean(decodeJsonObject(payloadSegment));
}

function isBase64UrlCharacter(characterCode) {
  return (characterCode >= 65 && characterCode <= 90)
    || (characterCode >= 97 && characterCode <= 122)
    || (characterCode >= 48 && characterCode <= 57)
    || characterCode === 45 || characterCode === 95;
}

function redactCompactJwts(value) {
  if (typeof value !== 'string' || !value.includes('.')) return value;
  let output = '';
  let cursor = 0;
  let previousDot = -1;
  let firstDot = value.indexOf('.');
  let secondDot = firstDot < 0 ? -1 : value.indexOf('.', firstDot + 1);
  while (secondDot >= 0) {
    const payload = value.slice(firstDot + 1, secondDot);
    if (decodeJsonObject(payload)) {
      const earliestHeaderStart = Math.max(previousDot + 1, firstDot - MAX_HEADER_SEGMENT_LENGTH);
      for (let start = earliestHeaderStart; start <= firstDot - 4; start += 1) {
        const header = value.slice(start, firstDot);
        if (!isCompactJwt(header, payload)) continue;

        let end = secondDot + 1;
        while (end < value.length && isBase64UrlCharacter(value.charCodeAt(end))) end += 1;
        if (start >= cursor) output += `${value.slice(cursor, start)}[REDACTED]`;
        cursor = Math.max(cursor, end);
        break;
      }
    }
    previousDot = firstDot;
    firstDot = secondDot;
    secondDot = value.indexOf('.', firstDot + 1);
  }
  return cursor ? output + value.slice(cursor) : value;
}

function containsCompactJwt(value) {
  return redactCompactJwts(value) !== value;
}

module.exports = { redactCompactJwts, containsCompactJwt };
