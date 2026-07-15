const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectFiles,
  CODEBASE_PIECES,
  SOURCE_ROOTS,
  startDefaultIndex,
  getStatus,
  _resetStatusForTests,
} = require('../services/defaultCodebaseIndexer');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  const w = (p, c) => {
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  };
  w('demo_api_server/a.js', 'const x = 1;\n');
  w('demo_api_ui/src/b.jsx', 'export const B = 2;\n');
  w('demo_mcp_gateway/g.js', 'exports.g = 1;\n');
  w('demo_authz_server/z.js', 'exports.z = 1;\n');
  w('demo_api_server/node_modules/dep/index.js', 'IGNORE ME');
  w('demo_api_server/.claude/x.js', 'IGNORE ME');
  w('demo_api_server/.env', 'SECRET=nope');
  w('demo_api_server/certs/ca.pem', 'PEM');
  w('demo_api_server/certs/allowed.js', 'IGNORE ME');
  w('langchain_agent/repo-src/demo_api_server/dup.js', 'IGNORE ME');
  w('demo_api_server/logo.png', 'PNGBYTES');
  return dir;
}

test('CODEBASE_PIECES covers UI, Server, Gateway, Authorize', () => {
  const names = CODEBASE_PIECES.map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining([
    'UI', 'API Server', 'MCP Gateway', 'Authorize',
  ]));
  expect(SOURCE_ROOTS).toContain('demo_api_ui/src');
  expect(SOURCE_ROOTS).toContain('demo_mcp_gateway');
  expect(SOURCE_ROOTS).toContain('demo_authz_server');
});

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

test('collectFiles with piece roots only collects that piece', () => {
  const dir = tmpRepo();
  const ui = collectFiles(dir, ['demo_api_ui/src']).map((f) => f.path);
  expect(ui).toContain('demo_api_ui/src/b.jsx');
  expect(ui).not.toContain('demo_api_server/a.js');

  const gw = collectFiles(dir, ['demo_mcp_gateway']).map((f) => f.path);
  expect(gw).toContain('demo_mcp_gateway/g.js');
  expect(gw).not.toContain('demo_authz_server/z.js');
});

test('collectFiles excludes a nested repo-src/ vendored copy even for allow-listed extensions', () => {
  const dir = tmpRepo();
  const paths = collectFiles(dir).map((f) => f.path);
  expect(paths.some((p) => p.includes('repo-src'))).toBe(false);
});

test('collectFiles excludes a nested certs/ dir even for allow-listed extensions', () => {
  const dir = tmpRepo();
  const paths = collectFiles(dir).map((f) => f.path);
  expect(paths.some((p) => p.includes('/certs/'))).toBe(false);
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

test('startDefaultIndex indexes each present piece under its own codebase_id', async () => {
  _resetStatusForTests();
  const dir = tmpRepo();
  const indexed = [];
  const client = {
    search: async () => ({ results: [] }),
    index: async (payload) => {
      indexed.push(payload.codebase_id);
      return { chunks_created: payload.files.length };
    },
  };
  await startDefaultIndex({ client, rootDir: dir });
  const st = getStatus();
  expect(st.state).toBe('ready');
  expect(indexed).toEqual(expect.arrayContaining([
    'ai-demo2-ui',
    'ai-demo2-server',
    'ai-demo2-mcp-gateway',
    'ai-demo2-authorize',
  ]));
  expect(st.pieces['ai-demo2-ui'].state).toBe('ready');
  expect(st.pieces['ai-demo2-server'].filesIndexed).toBeGreaterThan(0);
  // Missing packages on disk are skipped, not errors.
  expect(st.pieces['ai-demo2-ping-gateway'].state).toBe('skipped');
});
