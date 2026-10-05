import { execFile, spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { selectVitestMode } from './select-vitest-mode.mjs'

export const VITEST_RSS_LIMIT_BYTES = 4_000_000_000
const VITEST_HEAP_LIMIT_MB = 1_400
const POLL_INTERVAL_MS = 100
const TERMINATE_GRACE_MS = 250
// A process-table read that fails (in practice: `ps` exceeding its 2 s timeout
// on a busy CI host) is retried on the next poll. Only this many failures in a
// row stop the run, so RSS enforcement is blind for a few seconds at most
// rather than one slow `ps` discarding an otherwise healthy full-suite run.
const MAX_CONSECUTIVE_SNAPSHOT_FAILURES = 3
const TEST_FILES_PER_BATCH = 12
const execFileAsync = promisify(execFile)

export function parseProcessTable(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/)
      if (!match) return []

      return [{
        pid: Number(match[1]),
        ppid: Number(match[2]),
        rssBytes: Number(match[3]) * 1024,
        command: match[4] ?? '',
      }]
    })
}

function findVitestProcesses(processTable, rootPid) {
  const childrenByParent = new Map()
  for (const processInfo of processTable) {
    const siblings = childrenByParent.get(processInfo.ppid) ?? []
    siblings.push(processInfo)
    childrenByParent.set(processInfo.ppid, siblings)
  }

  const pending = [rootPid]
  const descendants = new Set()
  while (pending.length > 0) {
    const parentPid = pending.pop()
    for (const child of childrenByParent.get(parentPid) ?? []) {
      if (descendants.has(child.pid)) continue
      descendants.add(child.pid)
      pending.push(child.pid)
    }
  }

  descendants.add(rootPid)
  return processTable.filter(({ pid }) => descendants.has(pid))
}

export function findMemoryLimitExceeded(processTable, rootPid, limitBytes) {
  return findVitestProcesses(processTable, rootPid).find(
    (processInfo) => processInfo.rssBytes > limitBytes,
  ) ?? null
}

export function chunkTestFiles(files, batchSize) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError('batchSize must be a positive integer')
  }

  const batches = []
  for (let index = 0; index < files.length; index += batchSize) {
    batches.push(files.slice(index, index + batchSize))
  }
  return batches
}

export function parseVitestFileList(output) {
  const match = /(?:^|\r?\n)\s*\[\s*(?:\{|\])/.exec(output)
  if (!match) throw new Error('Vitest did not print a JSON test-file list')

  const jsonStart = output.indexOf('[', match.index)
  const jsonEnd = output.lastIndexOf(']')
  if (jsonEnd < jsonStart) throw new Error('Vitest printed an incomplete JSON test-file list')

  const fileEntries = JSON.parse(output.slice(jsonStart, jsonEnd + 1))
  if (!Array.isArray(fileEntries) || fileEntries.some(({ file }) => typeof file !== 'string')) {
    throw new Error('Vitest JSON test-file list has an unexpected format')
  }
  return fileEntries.map(({ file }) => file)
}

function processTableCommand() {
  return process.platform === 'darwin'
    ? ['-axo', 'pid=,ppid=,rss=,command=']
    : ['-eo', 'pid=,ppid=,rss=,args=']
}

async function readProcessTable() {
  const options = {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 2_000,
  }

  try {
    const { stdout } = await execFileAsync('ps', processTableCommand(), options)
    return parseProcessTable(stdout)
  } catch (error) {
    // A transient process-table spawn failure (for example EAGAIN while other
    // tools are busy) should not discard an otherwise healthy full-suite run.
    // Retry only fast resource errors; timeouts and `ps` failures still fail
    // closed immediately so RSS enforcement never silently goes blind.
    if (!['EAGAIN', 'EMFILE', 'ENFILE'].includes(error.code)) throw error
    await delay(25)
    const { stdout } = await execFileAsync('ps', processTableCommand(), options)
    return parseProcessTable(stdout)
  }
}

async function stopVitestTree(child) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
    if (signal === 'SIGTERM') await delay(TERMINATE_GRACE_MS)
  }
}

export async function monitorVitest(child, didFailToSpawn, {
  readProcessTable: readSnapshot = readProcessTable,
  stopProcessTree = stopVitestTree,
  rssLimitBytes = VITEST_RSS_LIMIT_BYTES,
  pollIntervalMs = POLL_INTERVAL_MS,
  maxSnapshotFailures = MAX_CONSECUTIVE_SNAPSHOT_FAILURES,
} = {}) {
  let peakProcess = null
  let snapshotFailures = 0
  while (
    child.exitCode === null &&
    child.signalCode === null &&
    !didFailToSpawn()
  ) {
    let processTable
    try {
      processTable = await readSnapshot()
      snapshotFailures = 0
    } catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) {
        return { peakProcess }
      }
      snapshotFailures += 1
      const errorDetails = [
        error.message,
        error.code !== undefined ? `code=${error.code}` : null,
        error.signal ? `signal=${error.signal}` : null,
        typeof error.stderr === 'string' && error.stderr.trim()
          ? `stderr=${error.stderr.trim()}`
          : null,
      ].filter(Boolean).join(' | ')
      if (snapshotFailures < maxSnapshotFailures) {
        console.error(`[vitest-memory-guard] Could not inspect worker RSS (${snapshotFailures} of ${maxSnapshotFailures} allowed in a row); retrying: ${errorDetails}`)
        await delay(pollIntervalMs)
        continue
      }
      console.error(`[vitest-memory-guard] Could not inspect worker RSS; stopping Vitest: ${errorDetails}`)
      await stopProcessTree(child)
      return { type: 'monitor-error', peakProcess }
    }

    for (const processInfo of findVitestProcesses(processTable, child.pid)) {
      if (!peakProcess || processInfo.rssBytes > peakProcess.rssBytes) {
        peakProcess = processInfo
      }
    }

    const exceeded = findMemoryLimitExceeded(
      processTable,
      child.pid,
      rssLimitBytes,
    )
    if (exceeded) {
      const rssGiB = (exceeded.rssBytes / 1_000_000_000).toFixed(2)
      console.error(
        `[vitest-memory-guard] PID ${exceeded.pid} (${exceeded.command}) reached ${rssGiB} GB RSS; limit is 4.00 GB. Stopping the complete Vitest run.`,
      )
      await stopProcessTree(child)
      return { type: 'memory-limit', processInfo: exceeded, peakProcess }
    }

    await delay(pollIntervalMs)
  }

  return { peakProcess }
}

async function runVitest(vitestArgs, { captureStdout = false } = {}) {
  const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
  const guardedConfig = fileURLToPath(new URL('./vitest-memory-guard.config.mjs', import.meta.url))
  const [command = 'run', ...args] = vitestArgs
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${VITEST_HEAP_LIMIT_MB}`,
      vitestCli,
      command,
      '--config',
      guardedConfig,
      ...args,
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      detached: true,
      stdio: captureStdout ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    },
  )

  let stdout = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk) => {
    stdout += chunk
  })

  let spawnFailed = false
  child.once('error', () => {
    spawnFailed = true
  })

  const stopOnSignal = (signal) => {
    void stopVitestTree(child).finally(() => {
      process.exitCode = signal === 'SIGINT' ? 130 : 143
    })
  }
  process.once('SIGINT', stopOnSignal)
  process.once('SIGTERM', stopOnSignal)

  const childResult = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }))
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const monitorResult = monitorVitest(child, () => spawnFailed)
  const result = await childResult
  const monitorFailure = await monitorResult
  process.removeListener('SIGINT', stopOnSignal)
  process.removeListener('SIGTERM', stopOnSignal)

  if (result.error) {
    console.error(`[vitest-memory-guard] Could not start Vitest: ${result.error.message}`)
    return { code: 1, stdout, monitorFailure }
  }
  if (monitorFailure?.type === 'memory-limit' || monitorFailure?.type === 'monitor-error') {
    return { code: 1, stdout, monitorFailure }
  }

  return {
    code: result.code ?? (result.signal ? 1 : 0),
    stdout,
    monitorFailure,
  }
}

function printPeakRss(peakProcess, label) {
  if (peakProcess) {
    const peakGiB = (peakProcess.rssBytes / 1_000_000_000).toFixed(2)
    console.log(
      `[vitest-memory-guard] ${label} peak process RSS: ${peakGiB} GB (PID ${peakProcess.pid}); limit 4.00 GB.`,
    )
  }
}

function largerProcess(left, right) {
  if (!left) return right
  if (!right) return left
  return right.rssBytes > left.rssBytes ? right : left
}

function reportDiscoveryLogs(output) {
  const match = /(?:^|\r?\n)\s*\[\s*(?:\{|\])/.exec(output)
  const logs = match ? output.slice(0, match.index).trim() : output.trim()
  if (logs) process.stdout.write(`${logs}\n`)
}

function hasTestFileFilters(args) {
  return args.some((arg) =>
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(arg) ||
    arg.includes('/') ||
    /[*?]/.test(arg),
  )
}

async function runFullUnitSuite(options) {
  const discovery = await runVitest(['list', '--filesOnly', '--json'], { captureStdout: true })
  reportDiscoveryLogs(discovery.stdout)
  let peakProcess = discovery.monitorFailure?.peakProcess ?? null

  if (discovery.code !== 0) {
    printPeakRss(peakProcess, 'File discovery')
    return discovery.code
  }

  let files
  try {
    files = parseVitestFileList(discovery.stdout)
  } catch (error) {
    console.error(`[vitest-memory-guard] Could not discover UI test files: ${error.message}`)
    printPeakRss(peakProcess, 'File discovery')
    return 1
  }

  if (files.length === 0) {
    console.error('[vitest-memory-guard] Vitest discovered no UI test files; refusing an empty run.')
    printPeakRss(peakProcess, 'File discovery')
    return 1
  }

  const batches = chunkTestFiles(files, TEST_FILES_PER_BATCH)
  console.log(
    `[vitest-memory-guard] Running ${files.length} UI test files in ${batches.length} batches of at most ${TEST_FILES_PER_BATCH}; each batch starts fresh workers.`,
  )

  for (const [index, batch] of batches.entries()) {
    const batchNames = batch.map((file) => file.split(/[\\/]/).at(-1)).join(', ')
    console.log(
      `[vitest-memory-guard] Batch ${index + 1}/${batches.length}: ${batch.length} files (${batchNames}).`,
    )
    const result = await runVitest(['run', ...options, ...batch])
    peakProcess = largerProcess(peakProcess, result.monitorFailure?.peakProcess)
    printPeakRss(peakProcess, 'Overall')
    if (result.code !== 0) return result.code
  }

  return 0
}

function parseRelatedFileList(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  const files = JSON.parse(raw)
  if (!Array.isArray(files)) throw new Error('changed UI paths must be a JSON array')
  return files
}

async function runPrRelatedUnitSuite() {
  let changedFiles
  try {
    changedFiles = parseRelatedFileList(process.env.VITEST_RELATED_FILES_JSON)
  } catch (error) {
    console.error(`[vitest-memory-guard] Cannot read PR UI paths: ${error.message}`)
    return 1
  }

  const plan = selectVitestMode(changedFiles)
  console.log(
    `[vitest-memory-guard] PR UI test mode: ${plan.mode} (${plan.reason}); ${plan.sourceFiles.length} related source files, ${plan.testFiles.length} changed test files.`,
  )

  if (plan.mode === 'full') return runFullUnitSuite([])

  let peakProcess = null
  if (plan.sourceFiles.length > 0) {
    const related = await runVitest(['related', '--run', ...plan.sourceFiles])
    peakProcess = largerProcess(peakProcess, related.monitorFailure?.peakProcess)
    if (related.code !== 0) {
      printPeakRss(peakProcess, 'PR related suite')
      return related.code
    }
  }

  if (plan.testFiles.length > 0) {
    const changedTests = await runVitest(['run', ...plan.testFiles])
    peakProcess = largerProcess(peakProcess, changedTests.monitorFailure?.peakProcess)
    if (changedTests.code !== 0) {
      printPeakRss(peakProcess, 'PR changed-test suite')
      return changedTests.code
    }
  }

  printPeakRss(peakProcess, 'PR related suite')
  return 0
}

async function run() {
  if (!['darwin', 'linux'].includes(process.platform)) {
    console.error(
      `[vitest-memory-guard] RSS enforcement is unavailable on ${process.platform}; refusing to start Vitest without the 4 GB limit.`,
    )
    process.exitCode = 1
    return
  }

  const args = process.argv.slice(2)
  if (args[0] === 'pr-related') {
    process.exitCode = await runPrRelatedUnitSuite()
    return
  }

  if (args[0] === 'unit') {
    const options = args.slice(1)
    if (hasTestFileFilters(options)) {
      const result = await runVitest(['run', ...options])
      printPeakRss(result.monitorFailure?.peakProcess, 'Focused suite')
      process.exitCode = result.code
      return
    }

    process.exitCode = await runFullUnitSuite(options)
    return
  }

  const result = await runVitest(args.length > 0 ? args : ['run'])
  if (result.monitorFailure?.peakProcess) {
    const peakGiB = (result.monitorFailure.peakProcess.rssBytes / 1_000_000_000).toFixed(2)
    console.log(
      `[vitest-memory-guard] Peak process RSS: ${peakGiB} GB (PID ${result.monitorFailure.peakProcess.pid}); limit 4.00 GB.`,
    )
  }
  process.exitCode = result.code
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run()
}
