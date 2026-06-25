// banking_api_ui/src/services/toastLogStore.js
/** Max entries kept in memory (ring buffer). */
const MAX_TOAST_LOGS = 300;

let entries = [];
const listeners = new Set();

/**
 * @param {object} entry
 * @param {string} entry.timestamp ISO time
 * @param {string} entry.level info|warn|error|debug
 * @param {string} entry.message
 * @param {string} [entry.detail] extra JSON or text
 * @param {string} [entry.toastType] react-toastify type
 */
function append(entry) {
  entries = [...entries.slice(-(MAX_TOAST_LOGS - 1)), { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }];
  listeners.forEach(fn => {
    try {
      fn(entries);
    } catch {
      /* ignore */
    }
  });
}

function getAll() {
  return entries;
}

function clear() {
  entries = [];
  listeners.forEach(fn => {
    try {
      fn(entries);
    } catch {
      /* ignore */
    }
  });
}

/**
 * @param {(logs: object[]) => void} fn
 * @returns {() => void} unsubscribe
 */
function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const toastLogStore = {
  append,
  getAll,
  clear,
  subscribe,
};
