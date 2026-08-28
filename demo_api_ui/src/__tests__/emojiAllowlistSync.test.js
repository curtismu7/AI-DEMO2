import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The emoji allowlist is stated in five enforcing places. They had drifted:
 * REGRESSION_PLAN §0 and CLAUDE.md listed ten, the regression-guard skill six,
 * and a live test ten — so a legitimate emoji could be stripped by one agent
 * and restored by the next forever.
 *
 * §0 is the source of truth. This asserts the other four equal it.
 *
 * Historical planning docs under docs/ are deliberately NOT included: they
 * record what the list was at the time, and several list emoji as examples of
 * violations. Syncing those would rewrite history and poison the allowlist.
 */
const REPO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
);

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/** Pull the emoji out of a single statement, in order, de-duped. */
/**
 * Read to the END of the statement, not a fixed number of lines. A 12-line
 * window silently truncated §0 once the allowlist grew past it, so the test
 * compared a partial truth against complete mirrors and failed all four.
 */
function listed(text, anchor, span = 40) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.includes(anchor));
  expect(start, `anchor not found: ${anchor}`).toBeGreaterThan(-1);
  const window = lines.slice(start, start + span).join('\n');
  const found = window.match(
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}✅❌⚠✕✓]/gu,
  ) || [];
  return [...new Set(found.filter((c) => c !== '️'))];
}

describe('emoji allowlist is stated identically everywhere it is enforced', () => {
  const truth = listed(read('REGRESSION_PLAN.md'), 'Emoji rule (project-wide)');

  it('§0 is the source of truth and is non-trivial', () => {
    expect(truth.length).toBeGreaterThanOrEqual(11);
    expect(truth).toContain('🔐');
    expect(truth).toContain('🔧');
  });

  const mirrors = [
    ['CLAUDE.md', 'emoji allowlist only'],
    ['.claude/skills/regression-guard/SKILL.md', 'Emoji allowlist —'],
    ['.claude/skills/inspector-template/SKILL.md', '**Emoji allowlist**'],
  ];

  mirrors.forEach(([rel, anchor]) => {
    it(`${rel} matches §0`, () => {
      const mine = listed(read(rel), anchor);
      expect(new Set(mine)).toEqual(new Set(truth));
    });
  });

  it('the supportConsole enforcement test allows exactly the §0 set', () => {
    const src = read(
      'demo_api_ui/src/components/supportConsole/__tests__/supportConsoleConfig.test.js',
    );
    const arr = src.match(/const ALLOWED = \[([^\]]*)\]/)?.[1] ?? '';
    const mine = [...new Set(
      (arr.match(
        /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}✅❌⚠✕✓]/gu,
      ) || []).filter((c) => c !== '️'),
    )];
    expect(new Set(mine)).toEqual(new Set(truth));
  });
});
