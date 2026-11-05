'use strict';

/**
 * Generic, data-aware chat text for tool results.
 *
 * buildVerticalReply() answers some tools with a sentence built from the tool NAME and nothing from the
 * result ("Here are your permits.", "Your pay fee request is complete."). Chat-only clients (the Studio, the
 * learning page, Dot, the pop-out) show only that sentence, so the user never sees their data. Instead of one
 * hand-written branch per tool, this reads the result itself: a list becomes a count plus its first items, a
 * single record becomes its first few fields, and a write that reports `false` passes its own note through.
 *
 * It only ever REPLACES a canned sentence (enrichCannedReply returns null for anything else), so replies that
 * are already specific do not change. `sensitive_*` tools are never expanded, and sensitive-looking fields are
 * never repeated.
 */

// Canned = built from the tool name alone. Count-only ("Here are your Activity (10 total).") is the same problem in
// a milder form: it says how many, never what.
const CANNED = /^(Here (?:are|is) your [^().:]+\.|Your [^().:]+ request is complete\.)$/i;
const COUNT_ONLY = /^Here are your ([^().:]+) \((\d+) total\)\.$/i;
const isCannedReply = (reply) => CANNED.test(String(reply || '').trim()) || COUNT_ONLY.test(String(reply || '').trim());

const META_KEY = /^(render|source|provenance|_links|meta|count|queriedAt|matchedBy|found)$/i;
const SENSITIVE_KEY = /ssn|passport|birth|dob|card|routing|iban|account.?num|password|secret|token|national|licen[sc]e|traveler|salary|tax.?id|cvv|pin$/i;
const LABEL_KEYS = ['title', 'name', 'product', 'permitType', 'recordType', 'course', 'provider', 'type', 'description', 'subject', 'label'];
const DATE_KEY = /(date|due|expires|expiry|lastVisit|when|deadline|renewal)/i;
const DEADLINE_KEY = /(due|expires|expiry|deadline|renewal)/i; // the date a person acts on, ahead of issued/created dates
const FAILURE_FLAGS = ['paid', 'booked', 'cancelled', 'approved', 'released', 'scheduled', 'submitted', 'success', 'ok'];

const humanize = (key) => String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
const dateLabel = (key) => humanize(key).replace(/ date$/, '') || humanize(key); // dueDate -> "due", expiresDate -> "expires"
const isScalar = (v) => v != null && ['string', 'number'].includes(typeof v) && String(v).trim() !== '';
const clean = (v) => {
  const s = String(typeof v === 'number' ? v.toLocaleString('en-US') : v).trim();
  const day = /^(\d{4}-\d{2}-\d{2})T/.exec(s); // ISO timestamp -> the date as written
  return (day ? day[1] : s).slice(0, 40);
};
const usable = (obj, key) => !META_KEY.test(key) && !SENSITIVE_KEY.test(key) && isScalar(obj[key]);

/** One list item as a short line: label, status, first date, id. Fields the item lacks are omitted. */
function itemLine(item) {
  if (!item || typeof item !== 'object') return null;
  const labelKey = LABEL_KEYS.find((k) => usable(item, k));
  const label = labelKey ? clean(item[labelKey]) : null;
  const dateKeys = Object.keys(item).filter((k) => DATE_KEY.test(k) && usable(item, k) && typeof item[k] === 'string');
  const dateKey = dateKeys.find((k) => DEADLINE_KEY.test(k)) || dateKeys[0];
  const parts = [
    label,
    usable(item, 'status') && clean(item.status),
    dateKey && (dateLabel(dateKey) === 'date' ? clean(item[dateKey]) : `${dateLabel(dateKey)} ${clean(item[dateKey])}`),
  ].filter(Boolean);
  const id = usable(item, 'id') ? clean(item.id) : null;
  if (!parts.length) return id;
  return id && id !== label ? `${parts.join(' · ')} (${id})` : parts.join(' · ');
}

/** A single record as "field value" pairs, first few usable scalars. */
function recordParts(data) {
  return Object.keys(data)
    .filter((k) => usable(data, k))
    .slice(0, 4)
    .map((k) => `${humanize(k)} ${clean(data[k])}`);
}

/**
 * @param {string} cannedReply what buildVerticalReply produced
 * @param {string} action the tool name
 * @param {unknown} data the tool result
 * @returns {string|null} a data-bearing replacement, or null to keep the canned reply
 */
function enrichCannedReply(cannedReply, action, data) {
  if (!isCannedReply(cannedReply) || /^sensitive_/.test(action) || !data || typeof data !== 'object') return null;

  // A write that reports it did not happen says why in its own words (never "request is complete").
  const failed = FAILURE_FLAGS.find((k) => data[k] === false);
  if (failed) {
    const note = [data.note, data.message, data.reason].find((t) => typeof t === 'string' && t.trim());
    if (note) return note.trim();
  }

  const lists = Object.entries(data).filter(([k, v]) => !META_KEY.test(k) && Array.isArray(v));
  const listed = lists.find(([, v]) => v.length && v[0] && typeof v[0] === 'object');
  if (listed) {
    const [key, items] = listed;
    const total = Number.isFinite(data.count) ? data.count : items.length;
    const lines = items.slice(0, 3).map(itemLine).filter(Boolean);
    if (!lines.length) return null;
    const more = total - lines.length;
    // Keep the vertical's own noun when the reply already had one ("Activity", "Purchases"); else name the list.
    const noun = (COUNT_ONLY.exec(String(cannedReply).trim()) || [])[1] || humanize(key);
    return `Here are your ${noun} (${total}): ${lines.join('; ')}${more > 0 ? ` and ${more} more` : ''}.`;
  }
  if (lists.length && lists.every(([, v]) => v.length === 0)) return `You have no ${(COUNT_ONLY.exec(String(cannedReply).trim()) || [])[1] || humanize(lists[0][0])}.`;

  const parts = recordParts(data);
  if (!parts.length) return null;
  return `${cannedReply.trim().replace(/\.$/, '')}: ${parts.join(' · ')}.`;
}

module.exports = { enrichCannedReply, isCannedReply, itemLine };
