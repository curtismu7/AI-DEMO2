// demo_api_ui/src/pages/check/status.js
const RANK = { fail: 3, warn: 2, pass: 1, skip: 0 };

export function worst(statuses) {
  if (!statuses.length) return 'idle';
  const top = statuses.reduce((a, s) => (RANK[s] > RANK[a] ? s : a), 'skip');
  return top === 'skip' ? 'pass' : top;
}

export function groupByCategory(catalog, results) {
  const cats = {};
  for (const c of catalog?.checks || []) {
    (cats[c.category] ||= []).push({ ...c, result: results[c.id] || null });
  }
  return cats;
}
