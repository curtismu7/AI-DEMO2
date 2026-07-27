// Replay handoff: carry one already-executed request from the Token Chain
// TraceRail into the matching inspector page so the learner can watch it run
// again in the test tool.
//
// The payload rides in sessionStorage (not the URL) — P1AZ parameter sets and
// MCP tool arguments are unbounded, and the target opens in a new tab, which
// same-origin sessionStorage survives. The URL carries only a short id.

const KEY_PREFIX = "tctr:replay:";
export const REPLAY_PARAM = "replay";

let seq = 0;

/**
 * Stash a replay payload and return the URL to open (href + ?replay=<id>).
 * Returns null when there is nothing to replay or storage is unavailable.
 * @param {{target: string, href: string}} replay descriptor from buildTraceSteps
 */
export function stageReplay(replay) {
  if (!replay || !replay.href) return null;
  const id = `${replay.target || "r"}-${++seq}-${Date.now()}`;
  try {
    window.sessionStorage.setItem(KEY_PREFIX + id, JSON.stringify(replay));
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
    const raw = window.sessionStorage.getItem(KEY_PREFIX + id);
    window.sessionStorage.removeItem(KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
