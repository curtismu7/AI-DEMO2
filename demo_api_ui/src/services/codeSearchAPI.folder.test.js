import { filterFolderFiles } from './codeSearchAPI';

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
