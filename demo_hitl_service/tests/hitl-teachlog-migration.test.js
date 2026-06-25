'use strict';

const { readFileSync } = require('fs');
const { join } = require('path');

const files = ['src/index.js', 'src/routes/challenges.js', 'src/notifier.js'];

describe('hitl console migration', () => {
  it.each(files)('%s has no raw console.* calls', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    expect(src.match(/console\s*\.\s*(log|error|warn|info|debug|trace)\s*\(/g) || []).toEqual([]);
  });
  it('index.js requires teachLogger', () => {
    const src = readFileSync(join(__dirname, '../src/index.js'), 'utf8');
    expect(src).toMatch(/require\(['"]\.\/teachLogger['"]\)/);
  });
});
