import { filterFolderFiles, planFolderIndex } from './codeSearchAPI';

function fakeFile(relPath, size = 10) {
  return { name: relPath.split('/').pop(), webkitRelativePath: relPath, size };
}

test('filterFolderFiles keeps code, drops vendored/binary/oversize', () => {
  const list = [
    fakeFile('proj/src/a.js'),
    fakeFile('proj/node_modules/dep/i.js'),
    fakeFile('proj/img.png'),
    fakeFile('proj/big.ts', 300 * 1024),
    fakeFile('proj/README.md'),
  ];
  const { accepted, skipped } = filterFolderFiles(list);
  const names = accepted.map((f) => f.webkitRelativePath);
  expect(names).toContain('proj/src/a.js');
  expect(names).toContain('proj/README.md');
  expect(names.some((p) => p.includes('node_modules'))).toBe(false);
  expect(names.some((p) => p.endsWith('.png'))).toBe(false);
  expect(names.some((p) => p.endsWith('big.ts'))).toBe(false);
  expect(skipped).toBe(3);
});

test('planFolderIndex stays single for one package folder', () => {
  const plan = planFolderIndex([
    fakeFile('demo_api_ui/src/a.js'),
    fakeFile('demo_api_ui/src/b.jsx'),
  ]);
  expect(plan.mode).toBe('single');
  expect(plan.name).toBe('demo_api_ui');
});

test('planFolderIndex splits a multi-package repo root', () => {
  const plan = planFolderIndex([
    fakeFile('AI-DEMO2/demo_api_ui/src/a.js'),
    fakeFile('AI-DEMO2/demo_api_server/b.js'),
    fakeFile('AI-DEMO2/demo_mcp_gateway/c.js'),
  ]);
  expect(plan.mode).toBe('pieces');
  expect([...plan.groups.keys()].sort()).toEqual([
    'demo_api_server',
    'demo_api_ui',
    'demo_mcp_gateway',
  ]);
});
