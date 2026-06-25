/**
 * Educational page detection — used to skip BFF prefetches on routes that
 * render documentation only (sequence diagrams, architecture flows). These
 * pages don't issue user-action MCP calls, so eager token prefetches (e.g.
 * agent-cc-preview, session-preview) produce noisy 401s in the console without
 * helping the user.
 *
 * Source-of-truth: routes registered in banking_api_ui/src/App.js. Keep in
 * sync if new educational pages are added.
 */

const EDUCATIONAL_PATH_PREFIXES = [
  '/sequence-diagram',
  '/architecture',  // covers /architecture/system, /architecture/flow, etc.
];

export function isEducationalPath(pathname = window.location.pathname) {
  return EDUCATIONAL_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(prefix + '/')
  );
}
