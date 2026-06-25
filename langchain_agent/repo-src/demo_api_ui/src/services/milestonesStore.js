/**
 * milestonesStore.js
 * Imperative singleton store for OIDC flow milestones.
 * Mirrors the agentFlowDiagramService pattern so bankingAgentService (non-React)
 * can call addMilestone() directly, while React components subscribe for updates.
 *
 * Milestone structure:
 *   { id, name, type, timestamp, status, details }
 *
 * Types: oidc_login | exchange_start | exchange_complete | mcp_tool_call | backend_operation | flow_complete
 * Status: pending | active | done | error
 */

const MILESTONES_KEY  = 'flowMilestones';
const MAX_MILESTONES  = 50;

// ─── Internal state ────────────────────────────────────────────────────────────

/** @type {Array<{id:string,name:string,type:string,timestamp:string,status:string,details:object}>} */
let milestones = [];
const listeners = new Set();

// ─── localStorage helpers ──────────────────────────────────────────────────────

function persistToStorage(list) {
  try {
    localStorage.setItem(MILESTONES_KEY, JSON.stringify(list));
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      try {
        // Evict oldest 10 and retry
        const trimmed = list.slice(10);
        localStorage.setItem(MILESTONES_KEY, JSON.stringify(trimmed));
      } catch (_) {}
    }
  }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(MILESTONES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// Hydrate on module load (browser only)
if (typeof localStorage !== 'undefined') {
  milestones = loadFromStorage();
}

// ─── Emit helpers ──────────────────────────────────────────────────────────────

function emit() {
  const snap = milestones.map((m) => ({ ...m, details: { ...m.details } }));
  listeners.forEach((fn) => {
    try { fn(snap); } catch (_) {}
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to milestone changes.
 * @param {function(Array)} listener - called with an immutable snapshot
 * @returns {function} unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  // Emit current state immediately so the subscriber hydrates
  try { listener(milestones.map((m) => ({ ...m }))); } catch (_) {}
  return () => listeners.delete(listener);
}

/**
 * Add a new milestone in 'pending' status.
 * @param {string} name    - display name, e.g. "OIDC Authentication"
 * @param {string} type    - one of the typedefs above
 * @param {object} [details] - optional details bag
 * @returns {string} milestoneId — use this to call updateMilestoneStatus later
 */
export function addMilestone(name, type, details = {}) {
  const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const milestone = {
    id,
    name,
    type,
    timestamp: new Date().toISOString(),
    status: 'pending',
    details: details || {},
  };
  milestones = [...milestones, milestone].slice(-MAX_MILESTONES);
  persistToStorage(milestones);
  emit();
  return id;
}

/**
 * Update a milestone's status (and optionally merge more details).
 * @param {string} milestoneId
 * @param {'pending'|'active'|'done'|'error'} newStatus
 * @param {object} [moreDetails]  - merged into existing details
 */
export function updateMilestoneStatus(milestoneId, newStatus, moreDetails = {}) {
  milestones = milestones.map((m) =>
    m.id === milestoneId
      ? { ...m, status: newStatus, details: { ...m.details, ...moreDetails } }
      : m
  );
  persistToStorage(milestones);
  emit();
}

/**
 * Clear all milestones (call on logout).
 */
export function clearMilestones() {
  milestones = [];
  try { localStorage.removeItem(MILESTONES_KEY); } catch (_) {}
  emit();
}

/**
 * Get current snapshot (synchronous).
 * @returns {Array}
 */
export function getMilestones() {
  return milestones.map((m) => ({ ...m }));
}

// Named export object for convenience
const milestonesStore = { subscribe, addMilestone, updateMilestoneStatus, clearMilestones, getMilestones };
export default milestonesStore;
