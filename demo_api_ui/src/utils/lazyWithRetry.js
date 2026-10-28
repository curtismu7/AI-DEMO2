import { lazy } from "react";

// React.lazy for route chunks that survives a deploy during a session.
//
// After a deploy the hashed chunk files the open tab knows about are gone, so a dynamic import() rejects
// ("Failed to fetch dynamically imported module"). The browser remembers a failed import for the life of the page, so
// trying the same import() again does not help (measured in Chromium: no second request). What recovers is a reload,
// which fetches the new index.html and its new hashes. So: on a chunk-load error reload ONCE, guarded by sessionStorage
// so a chunk that is really broken surfaces its error instead of looping.

const RELOAD_KEY = "chunk-reload-at";
const RELOAD_WINDOW_MS = 30000;

export function isChunkLoadError(error) {
  const text = String((error && (error.message || error.name)) || error || "");
  return /dynamically imported module|Importing a module script failed|Loading (CSS )?chunk [\w-]+ failed|ChunkLoadError/i.test(text);
}

function reloadOnce(reload) {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false; // no sessionStorage: never reload, so a loop is impossible
  }
  reload();
  return true;
}

/** Import; on a chunk-load error reload once (guarded). While the page reloads the promise never settles. */
export async function importWithRetry(importer, { reload = () => window.location.reload() } = {}) {
  try {
    return await importer();
  } catch (error) {
    if (isChunkLoadError(error) && reloadOnce(reload)) return new Promise(() => {});
    throw error;
  }
}

export default function lazyWithRetry(importer) {
  return lazy(() => importWithRetry(importer));
}
