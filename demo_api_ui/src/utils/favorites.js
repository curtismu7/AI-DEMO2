// Header "Favorites" — pages you jump to a lot while testing/demoing. Per-browser
// only (localStorage), like dashboardLayout.js. Not shared, not server state.
const STORAGE_KEY = 'demo_header_favorites';
const CHANGED_EVENT = 'demo-favorites-changed';

// Seeded on first use so a fresh browser already has the two demo lanes.
const DEFAULT_FAVORITES = [
  { label: 'LLM Gateway', path: '/llm-gateway' },
  { label: 'AI Gateway Client', path: '/privilege-mcp-client' },
];

// Turn a route path into a readable label for "Add this page", handling the
// acronyms a naive Title Case would mangle (llm -> LLM, not Llm).
const ACRONYMS = { llm: 'LLM', mcp: 'MCP', ai: 'AI', api: 'API', ui: 'UI', oauth: 'OAuth', hitl: 'HITL', a2a: 'A2A' };
export function labelForPath(path) {
  const seg = String(path || '').split('/').filter(Boolean).pop() || 'home';
  return seg
    .split('-')
    .map((w) => ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

export function getFavorites() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      // First use: persist the seed so a later remove of a default actually sticks.
      saveFavorites(DEFAULT_FAVORITES);
      return [...DEFAULT_FAVORITES];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_FAVORITES];
    return parsed.filter((f) => f && typeof f.path === 'string' && typeof f.label === 'string');
  } catch {
    return [...DEFAULT_FAVORITES];
  }
}

function saveFavorites(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { favorites: list } }));
  } catch {
    /* ignore */
  }
}

export function isFavorite(path) {
  return getFavorites().some((f) => f.path === path);
}

export function addFavorite({ label, path }) {
  if (!path) return getFavorites();
  const list = getFavorites();
  if (list.some((f) => f.path === path)) return list;
  const next = [...list, { label: label || labelForPath(path), path }];
  saveFavorites(next);
  return next;
}

export function removeFavorite(path) {
  const next = getFavorites().filter((f) => f.path !== path);
  saveFavorites(next);
  return next;
}

export const FAVORITES_CHANGED_EVENT = CHANGED_EVENT;
