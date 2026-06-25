import { readFileSync } from 'fs';
import { join } from 'path';

describe('TokenIntrospector logging migration', () => {
  it('contains no raw console.* calls', () => {
    const src = readFileSync(
      join(__dirname, '../../src/auth/TokenIntrospector.ts'),
      'utf8',
    );
    const matches = src.match(/console\.(log|error|warn|debug)\(/g) || [];
    expect(matches).toEqual([]);
  });

  it('uses teachLog.step for the introspection teaching moment', () => {
    const src = readFileSync(
      join(__dirname, '../../src/auth/TokenIntrospector.ts'),
      'utf8',
    );
    expect(src).toMatch(/teachLog\.step\(/);
    expect(src).toMatch(/RFC 7662/);
  });
});
