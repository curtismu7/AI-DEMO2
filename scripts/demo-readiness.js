'use strict';

const readline = require('node:readline/promises');
const { stdin, stdout, stderr } = require('node:process');
const { startReadinessRun } = require('../demo_api_server/services/demoReadinessRunner');
const { redactReadinessValue } = require('../demo_api_server/services/demoReadinessReport');

const HELP = `Usage: npm run demo:ready -- [options]

Run the demo readiness audit, preview source-backed repairs, and execute the required scenario matrix.

Options:
  --target local|se|both  Select targets (default: both). A single target is diagnostic only.
  --json                  Write the final sanitized machine-readable report as JSON.
  -h, --help              Show this help.

Repairs are shown in full and require typing the exact repair plan digest once. The confirmation wait
counts toward the single 15-minute deadline. This standalone CLI has no verified administrator
identity, so a typed digest can never authorize a repair write; use Admin sidebar Reset Demo for
administrator-bound repair. Exit status is 0 only for full READY — BOTH TARGETS.
`;

function parseArgs(argv = []) {
  const parsed = { targets: ['local', 'se'], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') parsed.help = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--target') {
      const value = argv[++index];
      if (!['local', 'se', 'both'].includes(value)) throw new Error('--target must be local|se|both');
      parsed.targets = value === 'both' ? ['local', 'se'] : [value];
    } else throw new Error('unknown option: ' + arg);
  }
  return parsed;
}

function safeJson(value, space = 2) {
  return JSON.stringify(redactReadinessValue(value), null, space);
}

async function terminalConfirm(promptText, input = stdin, output = stderr) {
  const interfaceHandle = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
  try { return await interfaceHandle.question(promptText); }
  finally { interfaceHandle.close(); }
}

async function runCli(argv = process.argv.slice(2), options = {}) {
  const out = options.stdout || stdout;
  const err = options.stderr || stderr;
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) {
    err.write(error.message + '\n');
    return 2;
  }
  if (parsed.help) {
    out.write(HELP);
    return 0;
  }

  let previewPrinted = false;
  const confirm = options.confirm || ((promptText) => terminalConfirm(promptText));
  const start = options.start || startReadinessRun;
  const result = await start({
    targets: parsed.targets,
    confirmRepairs: async ({ digest, preview }) => confirm('Type the exact repair plan digest ' + digest + ' to apply these changes: ', { digest, preview }),
    onProgress: async (event) => {
      if (event.phase === 'repair-preview-ready') {
        previewPrinted = true;
        const message = 'Complete repair preview:\n' + safeJson(event.preview) + '\n';
        (parsed.json ? err : out).write(message);
      } else if (!parsed.json && options.showProgress !== false) {
        out.write('[demo-readiness] ' + event.phase + '\n');
      }
    },
    clock: options.clock,
    adapters: options.adapters,
  });

  if (!previewPrinted && result.repairPreview) {
    (parsed.json ? err : out).write('Complete repair preview:\n' + safeJson(result.repairPreview) + '\n');
  }
  if (parsed.json) out.write(safeJson(result) + '\n');
  else out.write((result.label || result.status || 'NOT READY') + '\n' + safeJson(result) + '\n');

  return result.ready === true && result.status === 'ready'
    && parsed.targets.length === 2 && parsed.targets.includes('local') && parsed.targets.includes('se') ? 0 : 1;
}

if (require.main === module) {
  runCli().then((code) => { process.exitCode = code; }).catch((error) => {
    stderr.write('Demo readiness failed: ' + redactReadinessValue(error?.message || 'unknown error') + '\n');
    process.exitCode = 1;
  });
}

module.exports = { HELP, parseArgs, runCli, safeJson, terminalConfirm };
