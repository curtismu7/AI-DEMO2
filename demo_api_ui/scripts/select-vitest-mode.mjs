const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
const COMPONENT_SOURCE = /^src\/components\/.+\.[jt]sx?$/
const BARREL_FILE = /(?:^|\/)index\.[cm]?[jt]sx?$/
// Keep this allowlist limited to leaf components whose production import graph
// has been checked. Unlisted components may be shared across screens; those
// edits must run the full suite until their isolation has been verified.
const VERIFIED_LEAF_COMPONENTS = new Set([
  'src/components/AgentRunTimeline.jsx',
])

function fullSuite(reason) {
  return { mode: 'full', reason, sourceFiles: [], testFiles: [] }
}

function changedPath(entry) {
  const filename = typeof entry === 'string' ? entry : entry?.filename
  if (typeof filename !== 'string' || !filename.trim()) return null
  return filename.trim().replaceAll('\\', '/').replace(/^\.\//, '')
}

export function selectVitestMode(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return fullSuite('changed UI paths are unavailable')
  }

  const sourceFiles = []
  const testFiles = []

  for (const entry of changedFiles) {
    const path = changedPath(entry)
    if (!path) return fullSuite('a changed UI path could not be read')

    if (typeof entry === 'object' && entry !== null) {
      if (entry.previous_filename || ['removed', 'renamed'].includes(entry.status)) {
        return fullSuite('deleted or renamed UI files can change import resolution')
      }
      if (entry.status && !['added', 'modified'].includes(entry.status)) {
        return fullSuite('a UI change has an unsupported file status')
      }
    }

    const relativePath = path.startsWith('demo_api_ui/')
      ? path.slice('demo_api_ui/'.length)
      : path

    if (TEST_FILE.test(relativePath)) {
      if (relativePath.startsWith('src/') || relativePath.startsWith('scripts/__tests__/')) {
        testFiles.push(relativePath)
        continue
      }
      return fullSuite('a non-unit UI test changed')
    }

    if (COMPONENT_SOURCE.test(relativePath) && VERIFIED_LEAF_COMPONENTS.has(relativePath)) {
      sourceFiles.push(relativePath)
      continue
    }

    // Route modules can be loaded through App's dynamic imports, which Vitest's
    // related graph does not follow. Shared components, contexts, hooks,
    // services, styles, setup, and configuration can affect tests across the
    // UI, so keep those changes on the complete suite.
    return fullSuite('shared, route-level, styling, or configuration changes')
  }

  if (sourceFiles.length > 0) {
    return {
      mode: 'related',
      reason: 'component source changes',
      sourceFiles,
      testFiles,
    }
  }

  if (testFiles.length > 0) {
    return {
      mode: 'related',
      reason: 'changed unit test files',
      sourceFiles: [],
      testFiles,
    }
  }

  return fullSuite('no safe related-test targets were found')
}
