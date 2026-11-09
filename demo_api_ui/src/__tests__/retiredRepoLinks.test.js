// Outbound GitHub links must not point at the retired cmuir_pingcorp account: those repos do not resolve.
// The public homes are curtismu7/AI-DEMO2 and curtismu7/privilege-map-LAB.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function* sourceFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      yield* sourceFiles(full);
    } else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      yield full;
    }
  }
}

describe('outbound links', () => {
  it('no source file links to the retired cmuir_pingcorp repos', () => {
    const hits = [];
    for (const file of sourceFiles(SRC)) {
      if (/cmuir_pingcorp/.test(fs.readFileSync(file, 'utf8'))) hits.push(path.relative(SRC, file));
    }
    expect(hits).toEqual([]);
  });

  it('the privilege shelf blurb does not call the public Privilege Map repo private', () => {
    const shelf = fs.readFileSync(path.join(SRC, 'pages/PrivilegeShelfPage.jsx'), 'utf8');
    expect(shelf).not.toMatch(/private, sign-in required/);
    expect(shelf).toContain('https://github.com/curtismu7/privilege-map-LAB');
  });
});
