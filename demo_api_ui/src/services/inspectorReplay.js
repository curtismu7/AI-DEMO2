// Replay handoff: carry one already-executed request from the Token Chain
// TraceRail into the matching inspector page so the learner can watch it run
// again in the test tool.
//
// The payload rides in storage (not the URL) — P1AZ parameter sets and MCP tool
// arguments are unbounded. The URL carries only a short id.
//
// localStorage, NOT sessionStorage: the inspector opens via
// window.open(..., "noopener"), and a noopener context starts with a FRESH
// sessionStorage, so the payload would never arrive. Entries are removed on
// read, and any stragglers (tab closed before the page ran) are swept by age.

const KEY_PREFIX = "tctr:replay:";
export const REPLAY_PARAM = "replay";
/** Stale-entry sweep horizon — a handoff is consumed within seconds or never. */
const MAX_AGE_MS = 5 * 60 * 1000;

let seq = 0;

function sweep(store) {
  const now = Date.now();
  for (let i = store.length - 1; i >= 0; i -= 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const { stagedAt } = JSON.parse(store.getItem(key)) || {};
      if (!stagedAt || now - stagedAt > MAX_AGE_MS) store.removeItem(key);
    } catch {
      store.removeItem(key);
    }
  }
}

/**
 * Stash a replay payload and return the URL to open (href + ?replay=<id>).
 * Returns null when there is nothing to replay or storage is unavailable.
 * @param {{target: string, href: string}} replay descriptor from buildTraceSteps
 */
export function stageReplay(replay) {
  if (!replay || !replay.href) return null;
  const id = `${replay.target || "r"}-${++seq}-${Date.now()}`;
  try {
    sweep(window.localStorage);
    window.localStorage.setItem(
      KEY_PREFIX + id,
      JSON.stringify({ ...replay, stagedAt: Date.now() }),
    );
  } catch {
    return null; // private mode / quota — caller falls back to the plain link
  }
  const [path, query] = String(replay.href).split("?");
  const params = new URLSearchParams(query || "");
  params.set(REPLAY_PARAM, id);
  return `${path}?${params.toString()}`;
}

/**
 * Read and remove the replay payload named by ?replay=<id>. One-shot: a page
 * refresh must not re-fire a live call.
 * @param {URLSearchParams|string|null} search
 */
export function consumeReplay(search) {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const id = params?.get?.(REPLAY_PARAM);
  if (!id) return null;
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + id);
    window.localStorage.removeItem(KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
