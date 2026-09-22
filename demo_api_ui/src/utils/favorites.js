// Header "Favorites" — pages you jump to a lot while testing/demoing. Per-browser
// only (localStorage), like dashboardLayout.js. Not shared, not server state.
const STORAGE_KEY = 'demo_header_favorites';
const CHANGED_EVENT = 'demo-favorites-changed';
const AGENT_IDENTITY_ACADEMY_MIGRATION_KEY = 'demo_header_favorites_agent_identity_academy_v1';
const LEGACY_AGENT_IDENTITY_ACADEMY_PATH = '/academy-identity-preview.html';
const AGENT_IDENTITY_ACADEMY_FAVORITE = {
  label: 'Agent Identity Academy',
  path: '/academy/identity',
};

// Seeded on first use so a fresh browser already has the primary demo lanes.
const DEFAULT_FAVORITES = [
  { label: 'AI Guard', path: '/llm-gateway' },
  { label: 'AI Gateway Client', path: '/privilege-mcp-client' },
  AGENT_IDENTITY_ACADEMY_FAVORITE,
  { label: 'Guided Demo Tour', path: '/academy/journey' },
];

// Turn a route path into a readable label for "Add this page", handling the
// acronyms a naive Title Case would mangle (llm -> LLM, not Llm).
const ACRONYMS = { llm: 'LLM', mcp: 'MCP', ai: 'AI', api: 'API', ui: 'UI', oauth: 'OAuth', hitl: 'HITL', a2a: 'A2A' };
const FAVORITE_LABELS = {
  '/llm-gateway': 'AI Guard',
  [LEGACY_AGENT_IDENTITY_ACADEMY_PATH]: 'Agent Identity Academy',
  '/academy/identity': 'Agent Identity Academy',
  '/academy/journey': 'Guided Demo Tour',
};
export function labelForPath(path) {
  if (FAVORITE_LABELS[path]) return FAVORITE_LABELS[path];
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
      if (saveFavorites(DEFAULT_FAVORITES)) markAcademyMigrationComplete();
      return [...DEFAULT_FAVORITES];
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      if (saveFavorites(DEFAULT_FAVORITES)) markAcademyMigrationComplete();
      return [...DEFAULT_FAVORITES];
    }
    if (!Array.isArray(parsed)) {
      if (saveFavorites(DEFAULT_FAVORITES)) markAcademyMigrationComplete();
      return [...DEFAULT_FAVORITES];
    }
    const normalized = parsed
      .filter((f) => f && typeof f.path === 'string' && typeof f.label === 'string')
      .map((f) => {
        const path = f.path === LEGACY_AGENT_IDENTITY_ACADEMY_PATH
          ? AGENT_IDENTITY_ACADEMY_FAVORITE.path
          : f.path;
        return FAVORITE_LABELS[path] ? { ...f, path, label: FAVORITE_LABELS[path] } : { ...f, path };
      })
      .filter((favorite, index, favorites) =>
        favorites.findIndex((candidate) => candidate.path === favorite.path) === index,
      );
    if (normalized.some((favorite, index) => favorite.path !== parsed[index]?.path)) {
      saveFavorites(normalized);
    }
    if (localStorage.getItem(AGENT_IDENTITY_ACADEMY_MIGRATION_KEY) === '1') {
      return normalized;
    }

    const migrated = normalized.some((f) => f.path === AGENT_IDENTITY_ACADEMY_FAVORITE.path)
      ? normalized
      : [...normalized, AGENT_IDENTITY_ACADEMY_FAVORITE];
    // Mark the migration only after the migrated list is durable. Otherwise a
    // quota failure could suppress every future migration attempt.
    if (saveFavorites(migrated)) markAcademyMigrationComplete();
    return migrated;
  } catch {
    return [...DEFAULT_FAVORITES];
  }
}

function markAcademyMigrationComplete() {
  try {
    localStorage.setItem(AGENT_IDENTITY_ACADEMY_MIGRATION_KEY, '1');
  } catch {
    /* storage unavailable — retry migration on a later read */
  }
}

function saveFavorites(list) {
  let persisted = false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    persisted = true;
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { favorites: list } }));
  } catch {
    /* ignore */
  }
  return persisted;
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
