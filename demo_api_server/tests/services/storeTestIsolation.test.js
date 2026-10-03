const path = require('path');

// Guard: under jest the data store must not resolve to the operator's live
// data/runtimeData.json (it loaded those accounts and rewrote the file).
describe('data store under jest', () => {
  it('keeps runtimeData.json and backups out of data/', () => {
    const dir = process.env.DATA_STORE_DIR;
    expect(dir).toBeTruthy();
    expect(path.resolve(dir)).not.toBe(path.resolve(__dirname, '../../data'));
    const src = require('fs').readFileSync(path.join(__dirname, '../../data/store.js'), 'utf8');
    expect(src).toMatch(/process\.env\.DATA_STORE_DIR/);
  });
});
