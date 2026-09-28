import { describe, expect, it } from 'vitest'
import { selectVitestMode } from '../select-vitest-mode.mjs'

describe('PR Vitest selection', () => {
  it('selects related tests for leaf component source changes', () => {
    expect(selectVitestMode([
      { filename: 'demo_api_ui/src/components/AgentRunTimeline.jsx', status: 'modified' },
    ])).toEqual({
      mode: 'related',
      reason: 'component source changes',
      sourceFiles: ['src/components/AgentRunTimeline.jsx'],
      testFiles: [],
    })
  })

  it.each([
    ['shared demo steps dropdown', 'demo_api_ui/src/components/DemoStepsDropdown.jsx'],
    ['shared agent gateway tester', 'demo_api_ui/src/components/AgentGatewayTester.jsx'],
    ['shared token chain display', 'demo_api_ui/src/components/TokenChainDisplay.jsx'],
    ['unverified component', 'demo_api_ui/src/components/UnreviewedCard.jsx'],
  ])('runs the full suite for %s changes', (_label, filename) => {
    expect(selectVitestMode([{ filename, status: 'modified' }])).toMatchObject({
      mode: 'full',
    })
  })

  it('runs changed unit test files directly', () => {
    expect(selectVitestMode([
      { filename: 'demo_api_ui/src/components/__tests__/AgentGatewayTester.test.jsx', status: 'modified' },
    ])).toEqual({
      mode: 'related',
      reason: 'changed unit test files',
      sourceFiles: [],
      testFiles: ['src/components/__tests__/AgentGatewayTester.test.jsx'],
    })
  })

  it('combines direct tests with related tests for changed components', () => {
    expect(selectVitestMode([
      { filename: 'demo_api_ui/src/components/AgentRunTimeline.jsx', status: 'modified' },
      { filename: 'demo_api_ui/src/components/__tests__/AgentRunTimeline.test.jsx', status: 'modified' },
    ])).toEqual({
      mode: 'related',
      reason: 'component source changes',
      sourceFiles: ['src/components/AgentRunTimeline.jsx'],
      testFiles: ['src/components/__tests__/AgentRunTimeline.test.jsx'],
    })
  })

  it.each([
    ['App shell', 'demo_api_ui/src/App.js'],
    ['shared context', 'demo_api_ui/src/context/AgentUiModeContext.js'],
    ['shared hook', 'demo_api_ui/src/hooks/useAgentMode.js'],
    ['shared service', 'demo_api_ui/src/services/apiClient.js'],
    ['route-level page', 'demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx'],
    ['theme stylesheet', 'demo_api_ui/src/index.css'],
    ['component stylesheet', 'demo_api_ui/src/components/AgentGatewayTester.css'],
    ['test setup', 'demo_api_ui/src/setupTests.js'],
    ['build configuration', 'demo_api_ui/vite.config.js'],
  ])('runs the full suite for %s changes', (_label, filename) => {
    expect(selectVitestMode([{ filename, status: 'modified' }])).toMatchObject({
      mode: 'full',
    })
  })

  it('fails closed when changed paths are missing or invalid', () => {
    expect(selectVitestMode([])).toMatchObject({ mode: 'full' })
    expect(selectVitestMode([{ filename: 'demo_api_ui/src/components/Card.jsx', status: 'removed' }]))
      .toMatchObject({ mode: 'full' })
    expect(selectVitestMode([{ filename: 'demo_api_ui/src/components/Card.jsx', status: 'renamed' }]))
      .toMatchObject({ mode: 'full' })
    expect(selectVitestMode([{ filename: 'demo_api_ui/src/components/Card.jsx', previous_filename: 'demo_api_ui/src/components/OldCard.jsx', status: 'modified' }]))
      .toMatchObject({ mode: 'full' })
  })
})
