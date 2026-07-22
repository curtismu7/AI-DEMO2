/**
 * Session progress for the use-case launcher demo: which cards the presenter
 * has already Run/Open'd. Survives navigation away and back within the tab;
 * clears when the tab closes (sessionStorage).
 */

export const BX_UC_COMPLETED_KEY = 'bx_uc_completed';

/**
 * Parse stored ids into a Set.
 * @returns {Set<string>}
 */
export function getCompletedUseCaseIds() {
  try {
    const raw = sessionStorage.getItem(BX_UC_COMPLETED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === 'string' && id.length > 0));
  } catch {
    return new Set();
  }
}

/**
 * Persist a completed-id Set.
 * @param {Set<string>} ids
 */
function writeCompletedIds(ids) {
  try {
    sessionStorage.setItem(BX_UC_COMPLETED_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage may be unavailable
  }
}

/** Same-tab signal so Demo Steps + Actions popouts refresh checkmarks. */
export const BX_UC_PROGRESS_EVENT = 'bx-uc-progress';

/** Notify open popouts that completed-id set changed. */
function notifyProgressChanged() {
  try {
    window.dispatchEvent(new CustomEvent(BX_UC_PROGRESS_EVENT));
  } catch {
    // non-DOM / SSR
  }
}

/**
 * Mark a use case (catalog id, e.g. "UC1") as completed this session.
 * @param {string} useCaseCatalogId
 * @returns {Set<string>} updated set
 */
export function markUseCaseCompleted(useCaseCatalogId) {
  const ids = getCompletedUseCaseIds();
  if (!useCaseCatalogId || typeof useCaseCatalogId !== 'string') return ids;
  ids.add(useCaseCatalogId);
  writeCompletedIds(ids);
  notifyProgressChanged();
  return ids;
}

/** Clear all demo progress for a fresh presenter pass. */
export function clearCompletedUseCases() {
  try {
    sessionStorage.removeItem(BX_UC_COMPLETED_KEY);
  } catch {
    // ignore
  }
  notifyProgressChanged();
  return new Set();
}

/**
 * @param {string} useCaseCatalogId
 * @returns {boolean}
 */
export function isUseCaseCompleted(useCaseCatalogId) {
  return getCompletedUseCaseIds().has(useCaseCatalogId);
}
