// Decides whether the movie-reel Playwright lock (Chromium install + spec) must
// run for a PR. The reel renders on /dashboard from components/, hooks/,
// context/, CSS and the App shell, so only changes that cannot reach it may
// skip: test files, route pages under src/pages/ (lazy-loaded, not /dashboard),
// and public/ assets. Anything unreadable or unrecognised fails closed.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const CANNOT_REACH_REEL = /^(?:src\/pages\/(?!.*Dashboard).+\.(?:jsx?|css)|public\/.+)$/

export function reelGuardNeeded(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return true
  for (const entry of changedFiles) {
    const filename = typeof entry === 'string' ? entry : entry?.filename
    if (typeof filename !== 'string' || !filename.trim()) return true
    if (typeof entry === 'object' && entry !== null && (entry.previous_filename || entry.status === 'removed' || entry.status === 'renamed')) return true
    const path = filename.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/^demo_api_ui\//, '')
    if (TEST_FILE.test(path) && (path.startsWith('src/') || path.startsWith('scripts/'))) continue
    if (CANNOT_REACH_REEL.test(path)) continue
    return true
  }
  return false
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let files = []
  try { files = JSON.parse(process.env.VITEST_RELATED_FILES_JSON || '[]') } catch { files = [] }
  console.log(reelGuardNeeded(files) ? 'true' : 'false')
}
