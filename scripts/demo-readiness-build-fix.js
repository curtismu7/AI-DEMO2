'use strict';

const fs = require('node:fs/promises');
const { USE_CASES } = require('../demo_api_server/config/useCases');
const { prepareSourceFix } = require('../demo_api_server/services/demoReadinessBuildRepairService');
const { redactReadinessValue } = require('../demo_api_server/services/demoReadinessReport');

const HELP = `Usage: npm run demo:build-fix -- --case ID --base REV --patch-file FILE --test-plan FILE

Validate an offline unified diff in a disposable git worktree. Return an uncommitted
review patch and sanitized test/build evidence. The caller's tracked and nonignored
untracked checkout state must remain unchanged; ignored artifacts are outside this snapshot.

Options:
  --case ID          Checked-in use-case identifier with eligible declared codeRefs.
  --base REV         Committed revision for the candidate worktree.
  --patch-file FILE  Unified-diff data only. No commands or model/network integration.
  --test-plan FILE   Separately trusted JSON argv array: [{command,args,cwd?}]. Include
                     focused service/UI tests and a build; cwd is relative to candidate.
  -h, --help         Show help.

Candidate worktrees are removed after checks, whether verified or blocked. Review
output before applying it; redacted hunks may require reconstruction from safe source.
This build-time helper never runs from demo:ready or Admin Reset Demo.
`;

function parseArgs(argv) {
  const parsed = {};
  const options = { '--case': 'caseId', '--base': 'baseRevision', '--patch-file': 'patchFile', '--test-plan': 'testPlanFile' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--help' || argv[index] === '-h') parsed.help = true;
    else {
      const name = options[argv[index]];
      const value = argv[++index];
      if (!name || !value || value.startsWith('--') || parsed[name]) throw new Error('Invalid or duplicate build-fix option');
      parsed[name] = value;
    }
  }
  if (!parsed.help && Object.values(options).some((key) => !parsed[key])) throw new Error('--case, --base, --patch-file and --test-plan are required');
  return parsed;
}

function patchFileProvider(filename) {
  return async () => {
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Patch file must be bounded unified-diff data');
    return fs.readFile(filename, 'utf8');
  };
}

async function runCli(argv = process.argv.slice(2), options = {}) {
  const out = options.stdout || process.stdout;
  const err = options.stderr || process.stderr;
  try {
    const parsed = parseArgs(argv);
    if (parsed.help) { out.write(HELP); return 0; }
    const declared = USE_CASES.find((row) => row.id === parsed.caseId);
    if (!declared || !declared.codeRefs?.length) throw new Error('Case has no checked-in source references');
    const testPlan = JSON.parse(await fs.readFile(parsed.testPlanFile, 'utf8'));
    const result = await (options.prepareSourceFix || prepareSourceFix)({
      caseRow: { id: declared.id, codeRefs: [...declared.codeRefs] },
      sanitizedFailure: { kind: 'source-defect', reason: 'Operator supplied an offline source-defect candidate for focused verification.' },
      baseRevision: parsed.baseRevision,
      patchProvider: patchFileProvider(parsed.patchFile),
      testPlan,
    });
    out.write(JSON.stringify(redactReadinessValue(result), null, 2) + '\n');
    return result.status === 'verified' ? 0 : 1;
  } catch (error) {
    err.write(redactReadinessValue(error.message || 'Build-fix validation failed') + '\n');
    return 2;
  }
}

if (require.main === module) runCli().then((code) => { process.exitCode = code; });
module.exports = { HELP, parseArgs, patchFileProvider, runCli };
