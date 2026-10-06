import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  chunkTestFiles,
  findMemoryLimitExceeded,
  monitorVitest,
  parseVitestFileList,
  parseProcessTable,
  VITEST_RSS_LIMIT_BYTES,
} from '../run-vitest-with-memory-guard.mjs'
import { applyVitestMemoryLimits } from '../vitest-memory-guard.config.mjs'

async function waitForOutput(predicate, getOutput, timeoutMs = 3_000) {
  const startedAt = Date.now()
  while (!predicate(getOutput())) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for child-process output: ${getOutput()}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitForProcessExit(pid, timeoutMs = 2_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Process ${pid} did not exit within ${timeoutMs} ms`)
}

describe('Vitest memory guard', () => {
  it('sets the per-process RSS ceiling to exactly 4 GB', () => {
    expect(VITEST_RSS_LIMIT_BYTES).toBe(4_000_000_000)
  })

  it('overrides legacy fork heap and parallelism while preserving target test config', () => {
    const targetConfig = {
      resolve: { alias: { '@': '/target/src' } },
      test: {
        environment: 'jsdom',
        maxWorkers: 20,
        poolOptions: {
          forks: {
            execArgv: ['--max-old-space-size=12288'],
            maxForks: 20,
            minForks: 8,
          },
        },
      },
    }

    expect(applyVitestMemoryLimits(targetConfig)).toEqual({
      resolve: { alias: { '@': '/target/src' } },
      test: {
        environment: 'jsdom',
        pool: 'forks',
        maxWorkers: 2,
        poolOptions: {
          forks: {
            execArgv: ['--max-old-space-size=1400'],
            maxForks: 2,
            minForks: 1,
          },
        },
      },
    })
    expect(targetConfig.test.poolOptions.forks.execArgv).toEqual(['--max-old-space-size=12288'])
  })

  it('chunks a full test-file list without dropping or reordering files', () => {
    expect(chunkTestFiles(['a.test.js', 'b.test.js', 'c.test.js', 'd.test.js'], 3)).toEqual([
      ['a.test.js', 'b.test.js', 'c.test.js'],
      ['d.test.js'],
    ])
  })

  it('extracts Vitest JSON file output after config log lines', () => {
    expect(
      parseVitestFileList('[vite] config loaded\n[\n  {"file":"/a.test.js"},\n  {"file":"/b.test.js"}\n]'),
    ).toEqual(['/a.test.js', '/b.test.js'])
  })

  it('parses RSS in KiB and preserves commands containing spaces', () => {
    expect(
      parseProcessTable(`
        100 1 12000 node vitest
        101 100 2048 node (vitest worker 1)
      `),
    ).toEqual([
      { pid: 100, ppid: 1, rssBytes: 12_288_000, command: 'node vitest' },
      { pid: 101, ppid: 100, rssBytes: 2_097_152, command: 'node (vitest worker 1)' },
    ])
  })

  it('finds an over-limit Vitest descendant but allows exactly 4 GB', () => {
    const processTable = [
      { pid: 100, ppid: 1, rssBytes: 300_000_000, command: 'node vitest' },
      { pid: 101, ppid: 100, rssBytes: 4_000_000_000, command: 'node worker 1' },
      { pid: 102, ppid: 100, rssBytes: 4_000_001_024, command: 'node worker 2' },
      { pid: 200, ppid: 1, rssBytes: 8_000_000_000, command: 'unrelated process' },
    ]

    expect(findMemoryLimitExceeded(processTable, 100, 4_000_000_000)).toEqual(
      processTable[2],
    )
  })

  it('kills the complete Vitest process group when a worker exceeds 4 GB RSS', async () => {
    const workerScript = `
      process.on('SIGTERM', () => {
        process.stdout.write('WORKER_SIGTERM\\n')
        process.exit(0)
      })
      process.stdout.write('WORKER_READY\\n')
      setInterval(() => {}, 1000)
    `
    const leaderScript = `
      const { spawn } = require('node:child_process')
      process.on('SIGTERM', () => {
        process.stdout.write('LEADER_SIGTERM\\n')
        process.exit(0)
      })
      const worker = spawn(process.execPath, ['-e', ${JSON.stringify(workerScript)}], {
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      process.stdout.write('WORKER_PID=' + worker.pid + '\\n')
      setInterval(() => {}, 1000)
    `
    const child = spawn(process.execPath, ['-e', leaderScript], {
      detached: true,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })

    try {
      await waitForOutput(
        (value) => value.includes('WORKER_READY') && /WORKER_PID=\d+/.test(value),
        () => output,
      )
      const workerPid = Number(/WORKER_PID=(\d+)/.exec(output)[1])
      const processTable = [
        { pid: child.pid, ppid: process.pid, rssBytes: 100_000_000, command: 'node vitest' },
        { pid: workerPid, ppid: child.pid, rssBytes: VITEST_RSS_LIMIT_BYTES + 1, command: 'node vitest worker' },
      ]
      const leaderExit = once(child, 'exit')

      const result = await monitorVitest(child, () => false, {
        readProcessTable: async () => processTable,
        pollIntervalMs: 1,
      })
      await leaderExit
      await waitForProcessExit(workerPid)

      expect(result.type).toBe('memory-limit')
      expect(result.processInfo.pid).toBe(workerPid)
      expect(output).toContain('LEADER_SIGTERM')
      expect(output).toContain('WORKER_SIGTERM')
    } finally {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
  })

  it('rides out a process-table read that fails and then recovers', async () => {
    const child = { pid: 4242, exitCode: null, signalCode: null }
    const stopProcessTree = vi.fn()
    let reads = 0

    const result = await monitorVitest(child, () => false, {
      readProcessTable: async () => {
        reads += 1
        if (reads <= 2) throw Object.assign(new Error('Command failed: ps'), { signal: 'SIGTERM' })
        child.exitCode = 0
        return []
      },
      stopProcessTree,
      pollIntervalMs: 1,
    })

    expect(result.type).toBeUndefined()
    expect(reads).toBe(3)
    expect(stopProcessTree).not.toHaveBeenCalled()
  })

  it('stops the run once the process table cannot be read three times in a row', async () => {
    const child = { pid: 4242, exitCode: null, signalCode: null }
    const stopProcessTree = vi.fn()
    let reads = 0

    const result = await monitorVitest(child, () => false, {
      readProcessTable: async () => {
        reads += 1
        throw Object.assign(new Error('Command failed: ps'), { signal: 'SIGTERM' })
      },
      stopProcessTree,
      pollIntervalMs: 1,
      maxBlindMs: 0,
    })

    expect(result.type).toBe('monitor-error')
    expect(reads).toBe(3)
    expect(stopProcessTree).toHaveBeenCalledTimes(1)
  })

  it('does not stop on a burst of failures that spans no real time', async () => {
    const child = { pid: 4242, exitCode: null, signalCode: null }
    const stopProcessTree = vi.fn()
    let reads = 0

    const result = await monitorVitest(child, () => false, {
      readProcessTable: async () => {
        reads += 1
        if (reads <= 6) throw Object.assign(new Error('Command failed: ps'), { signal: 'SIGTERM' })
        child.exitCode = 0
        return []
      },
      stopProcessTree,
      pollIntervalMs: 1,
    })

    expect(result.type).toBeUndefined()
    expect(reads).toBe(7)
    expect(stopProcessTree).not.toHaveBeenCalled()
  })

  it('still stops once reads fail for longer than the blind window', async () => {
    const child = { pid: 4242, exitCode: null, signalCode: null }
    const stopProcessTree = vi.fn()

    const result = await monitorVitest(child, () => false, {
      readProcessTable: async () => {
        throw Object.assign(new Error('Command failed: ps'), { signal: 'SIGTERM' })
      },
      stopProcessTree,
      pollIntervalMs: 5,
      maxBlindMs: 40,
    })

    expect(result.type).toBe('monitor-error')
    expect(stopProcessTree).toHaveBeenCalledTimes(1)
  })
})
