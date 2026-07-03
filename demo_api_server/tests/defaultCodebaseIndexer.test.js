const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectFiles } = require('../services/defaultCodebaseIndexer');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  const w = (p, c) => {
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  };
  w('demo_api_server/a.js', 'const x = 1;\n');
  w('demo_api_ui/src/b.jsx', 'export const B = 2;\n');
  w('demo_api_server/node_modules/dep/index.js', 'IGNORE ME');
  w('.claude/worktrees/copy/demo_api_server/c.js', 'IGNORE ME');
  w('demo_api_server/.env', 'SECRET=nope');
  w('demo_api_server/certs/ca.pem', 'PEM');
  w('demo_api_server/logo.png', 'PNGBYTES');
  return dir;
}

test('collectFiles includes first-party source, excludes vendored/secrets/binaries', () => {
  const dir = tmpRepo();
  const files = collectFiles(dir);
  const paths = files.map((f) => f.path);
  expect(paths).toContain('demo_api_server/a.js');
  expect(paths).toContain('demo_api_ui/src/b.jsx');
  expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  expect(paths.some((p) => p.includes('.claude'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.env'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.pem'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.png'))).toBe(false);
});

test('collectFiles enforces a per-file size cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  fs.mkdirSync(path.join(dir, 'demo_api_server'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo_api_server/big.js'), 'x'.repeat(300 * 1024));
  fs.writeFileSync(path.join(dir, 'demo_api_server/small.js'), 'ok');
  const paths = collectFiles(dir).map((f) => f.path);
  expect(paths).toContain('demo_api_server/small.js');
  expect(paths).not.toContain('demo_api_server/big.js');
});
