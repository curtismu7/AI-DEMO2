/**
 * A ratchet, not a linter — same shape as themingRatchet.test.js.
 *
 * demo_api_ui runs on Vitest, not Jest. Every test file was renamed to vi.*
 * (75 files in PR #2873, plus the line-wrapped stragglers that rename missed),
 * and this keeps them that way. It is a hard zero, not a walking ratchet:
 * `jest` in a Vitest file is always wrong, never a not-yet-migrated file.
 *
 * Note this does NOT mean the `global.jest = vi` alias in src/setupTests.js is
 * removable — it is load-bearing for @testing-library's fake-timer detection,
 * which gates on `typeof jest !== 'undefined'`. Deleting it hangs any test that
 * combines vi.useFakeTimers() with waitFor(). The alias stays; the call sites
 * still say vi.*. See the comment on that line before touching it.
 *
 * The one that actually breaks rather than merely offends is `jest.mock()`:
 * Vitest hoists `vi.mock()` by statically matching that literal call in the
 * source, so a `jest.mock()` — even with a working alias — is NOT hoisted and
 * silently applies too late to mock a top-level import.
 *
 * `@testing-library/jest-dom` is a package name, not the Jest global, and is
 * deliberately not matched here.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(__dirname, '..', '..');

// ANY bare `jest` identifier, not `jest.<api>(`. The narrower form has a real
// blind spot that bit this repo: a prettier-wrapped call splits the token
// across lines —
//
//     fetchNlStatus: jest
//       .fn()
//       .mockResolvedValue(…)
//
// — so `jest\.[a-zA-Z]+\(` never matches. 18 such usages across 8 files
// survived the PR #2873 rename and only worked because the alias was still
// there; deleting it is what surfaced them. Comments and strings are stripped
// first, so `@testing-library/jest-dom` (a package name in an import string)
// and prose mentioning the rule do not count.
const JEST_IDENTIFIER = /\bjest\b/g;

// Strip comments and string/template literals: this rule is about CODE calling
// the jest API, and both this file and setupTests.js legitimately name `jest.*`
// in prose explaining the rule.
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

// This file states the rule, so it names `jest.*` throughout — stripping
// comments is not enough (the assertion messages name it too). Exclude it.
const SELF = path.basename(__filename);

function testFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === SELF) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(abs));
    else if (/\.(test|spec)\.jsx?$/.test(entry.name)) out.push(abs);
  }
  return out;
}

function jestApiCalls() {
  const hits = [];
  for (const f of testFiles(SRC)) {
    // Blanking comments/strings preserves offsets, so line numbers stay true.
    const src = stripCommentsAndStrings(fs.readFileSync(f, 'utf8'));
    for (const m of src.matchAll(JEST_IDENTIFIER)) {
      const line = src.slice(0, m.index).split('\n').length;
      hits.push(`${path.relative(SRC, f)}:${line} — ${m[0]}`);
    }
  }
  return hits;
}

describe('vitest API ratchet', () => {
  it('no test file calls the jest.* API — this project uses vi.*', () => {
    const hits = jestApiCalls();
    expect(
      hits,
      `demo_api_ui runs on Vitest — write the vi.* equivalent (vi.fn, vi.spyOn, ` +
        `vi.mock, vi.useFakeTimers, …). These only appear to work because ` +
        `src/setupTests.js aliases global.jest = vi, and that alias is kept for ` +
        `an unrelated reason (@testing-library's fake-timer detection), not to ` +
        `support the Jest API. vi.mock() specifically is NOT interchangeable: ` +
        `Vitest hoists only a literal vi.mock() call, so an aliased jest.mock() ` +
        `applies too late to mock a top-level import.\n  ` +
        `${hits.slice(0, 10).join('\n  ')}`,
    ).toEqual([]);
  });
});
