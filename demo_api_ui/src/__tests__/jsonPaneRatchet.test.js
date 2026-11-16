import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * JSON-pane ratchet (owner standard 2026-11-14): every place the UI shows JSON uses the shared JsonPane
 * (components/shared/JsonPane.jsx, directly or through JsonHighlight / FormJsonToggle). A hand-rolled pane is a
 * non-test source file that holds both a <pre ...> and a pretty JSON.stringify(x, null, N). This counts them and
 * fails when the count goes UP, so the number can only fall as pages are converted (phase 1 of the plan).
 * Lower the pin when you convert some; never raise it. Comments are ignored (a `<pre>` in a doc comment is not a pane);
 * test files are not counted; the shared pane itself is the standard, so it is the one allowed file.
 */
const SRC = path.resolve(__dirname, '..');
const MAX_HAND_ROLLED_PANES = 83;
const ALLOWED = ['components/shared/JsonPane.jsx'];

const PRE = /<pre[\s>]/;
const PRETTY_STRINGIFY = /JSON\.stringify\([^;]*?,\s*null\s*,\s*(?:\d+|['"][^'"]*['"])\s*\)/;

function sourceFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'node_modules') out.push(...sourceFiles(p));
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(e.name) && !/\.(?:test|spec)\./.test(e.name)) out.push(p);
  }
  return out;
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\w'"`])\/\/.*$/gm, '$1');

const isHandRolled = (source) => {
  const code = stripComments(source);
  return PRE.test(code) && PRETTY_STRINGIFY.test(code);
};

function handRolled() {
  return sourceFiles(SRC)
    .filter((f) => !ALLOWED.includes(path.relative(SRC, f).split(path.sep).join('/')))
    .filter((f) => isHandRolled(fs.readFileSync(f, 'utf8')))
    .map((f) => path.relative(SRC, f).split(path.sep).join('/'));
}

describe('JSON pane ratchet', () => {
  const files = handRolled();

  it('adds no new hand-rolled JSON pane', () => {
    expect(
      files.length,
      `hand-rolled JSON panes rose to ${files.length} (pin ${MAX_HAND_ROLLED_PANES}); render JSON with components/shared/JsonPane (or JsonHighlight) instead of <pre>{JSON.stringify(x, null, 2)}</pre>`,
    ).toBeLessThanOrEqual(MAX_HAND_ROLLED_PANES);
  });

  it('keeps the pin honest: lower it when the count drops', () => {
    expect(files.length, `only ${files.length} hand-rolled panes remain; lower MAX_HAND_ROLLED_PANES to ${files.length}`).toBeGreaterThanOrEqual(MAX_HAND_ROLLED_PANES);
  });

  it('detects a pane that pairs <pre> with a pretty JSON.stringify, and ignores comments and compact stringify', () => {
    expect(isHandRolled('const a = <pre>{JSON.stringify(x, null, 2)}</pre>;')).toBe(true);
    expect(isHandRolled('const a = <pre className="x">{JSON.stringify(x, null, "  ")}</pre>;')).toBe(true);
    expect(isHandRolled('// <pre>{JSON.stringify(x, null, 2)}</pre>\nconst a = 1;')).toBe(false);
    expect(isHandRolled('const a = <pre>{JSON.stringify(x)}</pre>;')).toBe(false);
    expect(isHandRolled('const s = JSON.stringify(x, null, 2);')).toBe(false);
  });
});
