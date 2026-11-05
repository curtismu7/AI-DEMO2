import { describe, expect, it } from 'vitest'
import { reelGuardNeeded } from '../reel-guard-needed.mjs'

const mod = (filename) => ({ filename, status: 'modified' })

describe('movie-reel guard selection', () => {
  it.each([
    'demo_api_ui/src/pages/MusePage.jsx',
    'demo_api_ui/src/pages/MusePage.css',
    'demo_api_ui/src/pages/__tests__/MusePage.test.jsx',
    'demo_api_ui/public/united-demos.html',
  ])('skips for %s', (f) => expect(reelGuardNeeded([mod(f)])).toBe(false))

  it.each([
    'demo_api_ui/src/components/ReelDock.jsx',
    'demo_api_ui/src/hooks/useReelSync.js',
    'demo_api_ui/src/context/AgentUiModeContext.js',
    'demo_api_ui/src/App.js',
    'demo_api_ui/src/index.css',
    'demo_api_ui/src/config/navPagePaths.js',
    'demo_api_ui/src/pages/CustomerDashboardPage.jsx',
    'demo_api_ui/package-lock.json',
    'demo_api_ui/tests/e2e/movie-reel-visible.spec.js',
  ])('runs for %s', (f) => expect(reelGuardNeeded([mod(f)])).toBe(true))

  it('runs if any one file can reach the reel', () => {
    expect(reelGuardNeeded([mod('demo_api_ui/src/pages/MusePage.jsx'), mod('demo_api_ui/src/components/ReelDock.jsx')])).toBe(true)
  })

  it('fails closed on missing, empty or removed paths', () => {
    expect(reelGuardNeeded([])).toBe(true)
    expect(reelGuardNeeded(undefined)).toBe(true)
    expect(reelGuardNeeded([{ filename: 'demo_api_ui/src/pages/A.jsx', status: 'removed' }])).toBe(true)
  })
})
