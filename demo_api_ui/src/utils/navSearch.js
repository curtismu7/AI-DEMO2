// Side-nav menu search. The query is split into words and EVERY word must appear (as a substring, in any order) in the
// item's label, its search alias or the words of its URL. Punctuation is ignored on both sides, so "id-jag", "id jag" and
// "ID-JAG" are the same; dots are kept so version numbers such as v1.261028 stay one word.

const normalize = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').trim();

export function navSearchTerms(query) {
  const n = normalize(query);
  return n ? n.split(' ') : [];
}

/** The text one nav item is searched against: label, search alias, and the words of its path (e.g. /token-chain -> "token chain"). */
export function navSearchText(item) {
  return normalize(`${item?.label || ''} ${item?.searchAlias || ''} ${item?.path || ''}`);
}

export function navItemMatches(item, query) {
  const terms = navSearchTerms(query);
  if (!terms.length) return true;
  const hay = navSearchText(item);
  return terms.every((t) => hay.includes(t));
}
