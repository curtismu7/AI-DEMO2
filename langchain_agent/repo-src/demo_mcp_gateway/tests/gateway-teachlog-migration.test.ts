'use strict';

import { readFileSync } from 'fs';
import { join } from 'path';

const files = [
  'src/middleware/authorizeMcpRequest.ts',
];

describe('gateway priority-1 console migration', () => {
  it.each(files)('%s has no raw console.* calls', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    // Broadened to catch info/trace and incidental whitespace, per review note.
    expect(src.match(/console\s*\.\s*(log|error|warn|debug|info|trace)\s*\(/g) || []).toEqual([]);
  });
});
