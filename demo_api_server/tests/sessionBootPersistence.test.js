const fs = require('node:fs');
const path = require('node:path');

describe('session boot persistence', () => {
  test('does not clear persisted sessions unless explicitly enabled', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../server.js'), 'utf8');
    expect(source).toContain("process.env.CLEAR_SESSIONS_ON_BOOT === 'true'");
    expect(source).not.toContain("process.env.CLEAR_SESSIONS_ON_BOOT !== 'false'");
  });
});
