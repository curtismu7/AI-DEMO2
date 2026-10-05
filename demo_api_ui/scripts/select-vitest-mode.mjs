const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/
// `vitest related` follows static and literal dynamic imports (verified against
// a React.lazy page), so edits to these modules map to every test that reaches
// them. Everything else (styles, setup, config, App, theme) is read by tests
// through the filesystem or global wiring and stays on the full suite.
const RELATED_SOURCE = /^src\/(?:components|pages|hooks|utils|services|features|context)\/.+\.[jt]sx?$/
const BARREL_FILE = /(?:^|\/)index\.[cm]?[jt]sx?$/

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

    if (RELATED_SOURCE.test(relativePath)) {
      sourceFiles.push(relativePath)
      continue
    }

    return fullSuite('styling, setup, configuration, or app-shell changes')
  }

  if (sourceFiles.length > 0) {
    return {
      mode: 'related',
      reason: 'module source changes',
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
