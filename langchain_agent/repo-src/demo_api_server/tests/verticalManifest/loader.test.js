const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLoader } = require('../../services/verticalManifest/loader');

function writeFixture(root, id, manifest, mockData = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'mock-data.json'), JSON.stringify(mockData));
}

const MIN = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
};

describe('loader', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vload-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('loadAll reads all subfolders', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' });
    writeFixture(root, 'b', { ...MIN, id: 'b' });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').manifest.id).toBe('a');
    expect(loader.get('b').manifest.id).toBe('b');
  });

  test('list returns ids and displayNames', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'Alpha' } });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.list()).toEqual([{ id: 'a', displayName: 'Alpha', tagline: undefined, theme: { cssVars: { '--x': '#000' } } }]);
  });

  test('boot fails loudly on invalid manifest', () => {
    writeFixture(root, 'bad', { id: 'bad' }); // missing required fields
    const loader = createLoader(root);
    expect(() => loader.loadAll()).toThrow(/bad/);
  });

  test('get returns null for unknown id', () => {
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('nope')).toBeNull();
  });

  test('reload(id) re-reads one folder', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'A1' } });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').manifest.identity.displayName).toBe('A1');
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'A2' } });
    loader.reload('a');
    expect(loader.get('a').manifest.identity.displayName).toBe('A2');
  });

  test('mock data is loaded', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' }, { records: [{ x: 1 }] });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').mockData).toEqual({ records: [{ x: 1 }] });
  });

  test('missing mock-data.json defaults to empty object', () => {
    const dir = path.join(root, 'a');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...MIN, id: 'a' }));
    // no mock-data.json
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').mockData).toEqual({});
  });

  test('removeFromCache evicts an id (used by delete)', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' });
    const loader = createLoader(root);
    loader.loadAll();
    loader.removeFromCache('a');
    expect(loader.get('a')).toBeNull();
  });
});
