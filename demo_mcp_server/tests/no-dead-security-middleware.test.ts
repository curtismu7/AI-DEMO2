/**
 * no-dead-security-middleware.test.ts — WS-E finding 3.
 *
 * src/middleware/ held three Express-shaped security modules
 * (mcpTokenValidator, mcpScopeValidator, validateTokenAtGateway) that were
 * imported by nothing. They could never have run:
 *
 *   - this server has no Express dependency; it is raw node:http + ws, so a
 *     `(req, res, next)` middleware has no request pipeline to sit in;
 *   - they read `req.user.token`, a property nothing in this codebase sets;
 *   - tsconfig.json does not set `allowJs`, so the .js files were not even
 *     emitted into dist/ — they were inert in every build.
 *
 * They nonetheless *looked* like enforcement — validateTokenAtGateway.js even
 * carried a comment claiming it was "Used by the WebSocket/Express path". Dead
 * security code that looks wired is worse than no code: it makes an auditor
 * believe a control exists. This test keeps the directory honest — any module
 * added under src/middleware/ must be imported by production code.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');
const MIDDLEWARE_DIR = join(SRC, 'middleware');

/** Recursively collect every source file under src/, excluding tests. */
function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__mocks__' || entry.name === '__tests__') continue;
      collectSourceFiles(full, acc);
    } else if (/\.(ts|js)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe('src/middleware — no orphaned security middleware', () => {
  it('every middleware module is imported by production code', () => {
    if (!existsSync(MIDDLEWARE_DIR)) return; // directory removed entirely — vacuously true

    const middlewareModules = readdirSync(MIDDLEWARE_DIR).filter((f) => /\.(ts|js)$/.test(f));
    if (middlewareModules.length === 0) return;

    const sources = collectSourceFiles(SRC)
      .filter((f) => !f.startsWith(MIDDLEWARE_DIR))
      .map((f) => readFileSync(f, 'utf8'));

    const orphans = middlewareModules.filter((mod) => {
      const base = mod.replace(/\.(ts|js)$/, '');
      return !sources.some((src) => src.includes(`middleware/${base}`));
    });

    expect(orphans).toEqual([]);
  });

  it('the specific dead modules identified in WS-E are gone', () => {
    expect(existsSync(join(MIDDLEWARE_DIR, 'mcpTokenValidator.js'))).toBe(false);
    expect(existsSync(join(MIDDLEWARE_DIR, 'mcpScopeValidator.js'))).toBe(false);
    expect(existsSync(join(MIDDLEWARE_DIR, 'validateTokenAtGateway.js'))).toBe(false);
  });
});
