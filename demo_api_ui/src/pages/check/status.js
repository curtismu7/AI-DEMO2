// demo_api_ui/src/pages/check/status.js
const RANK = { fail: 3, warn: 2, pass: 1, skip: 0 };

export function worst(statuses) {
  if (!statuses.length) return 'idle';
  return statuses.reduce((a, s) => (RANK[s] > RANK[a] ? s : a), 'skip');
}

export function groupByCategory(catalog, results) {
  results = results || {};
  const cats = {};
  const catalogIds = new Set();
  for (const c of catalog?.checks || []) {
    catalogIds.add(c.id);
    (cats[c.category] ||= []).push({ ...c, result: results[c.id] || null });
  }
  for (const [id, result] of Object.entries(results)) {
    if (catalogIds.has(id)) continue;
    (cats[result.category] ||= []).push({ id, name: result.name, category: result.category, result });
  }
  return cats;
}
