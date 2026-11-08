import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * scripts/check-no-ai-attribution.sh: the owner's own GitHub noreply Co-authored-by (added by GitHub's
 * squash merge) passes; any other Co-Authored-By, or the "Generated with" line, still fails.
 */
const SCRIPT = path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-no-ai-attribution.sh');
// The trailer text is assembled at runtime: the script also scans tracked files, so this file must not contain it literally.
const T = 'Co-' + 'authored-by: ';
const TU = 'Co-' + 'Authored-By: ';
const dirs = [];

function run(message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noai-'));
  dirs.push(dir);
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.name', 't');
  git('config', 'user.email', 't@example.invalid');
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'check-no-ai-attribution.sh'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git('add', '.');
  git('commit', '-q', '-m', message);
  return spawnSync('bash', ['scripts/check-no-ai-attribution.sh'], { cwd: dir, encoding: 'utf8' }).status;
}

describe('check-no-ai-attribution.sh', () => {
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('passes a plain commit', () => {
    expect(run('fix: plain')).toBe(0);
  });
  it('passes the owner noreply Co-authored-by that GitHub squash adds', () => {
    expect(run(`fix: x\n\n${T}curtismu7 <curtismu7@users.noreply.github.com>`)).toBe(0);
    expect(run(`fix: x\n\n${T}Curtis Muir <49688644+curtismu7@users.noreply.github.com>`)).toBe(0);
  });
  it('fails an AI Co-Authored-By trailer', () => {
    expect(run(`fix: x\n\n${TU}Some Assistant <assistant@example.invalid>`)).toBe(1);
  });
  it('fails an AI trailer even when the owner trailer is also present', () => {
    expect(
      run(`fix: x\n\n${T}curtismu7 <curtismu7@users.noreply.github.com>\n${TU}Bot <bot@example.invalid>`),
    ).toBe(1);
  });
  it('fails a lookalike address', () => {
    expect(run(`fix: x\n\n${T}curtismu7 <curtismu7@users.noreply.github.com.evil.invalid>`)).toBe(1);
  });
});
