'use strict';

import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo root, or null when we are not inside a checkout (e.g. the Docker image,
 * which contains only this service). Returning null rather than throwing keeps
 * importing this module side-effect-free — a throw here crash-looped the
 * container, because the ANF handler calls loadMockData at module scope.
 */
function findRepoRoot(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'banking-demo') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export const REPO_ROOT: string | null = findRepoRoot(__dirname);

/**
 * Baked copy shipped in the image (`COPY seed/ ./seed/`), same `__dirname`
 * depth the per-vertical Db modules use. Only the verticals that need to work
 * without a checkout are baked; the rest resolve from the repo below.
 */
function bakedPath(vertical: string): string {
  return path.join(__dirname, '..', '..', 'seed', `${vertical}.mock.json`);
}

function repoPath(vertical: string): string | null {
  if (!REPO_ROOT) return null;
  return path.join(REPO_ROOT, 'demo_api_server', 'config', 'verticals', vertical, 'mock-data.json');
}

export function loadMockData(vertical: string): Record<string, unknown> {
  const baked = bakedPath(vertical);
  if (fs.existsSync(baked)) {
    return JSON.parse(fs.readFileSync(baked, 'utf8')) as Record<string, unknown>;
  }
  const fromRepo = repoPath(vertical);
  if (fromRepo && fs.existsSync(fromRepo)) {
    return JSON.parse(fs.readFileSync(fromRepo, 'utf8')) as Record<string, unknown>;
  }
  throw new Error(
    `mock-data.json not found for vertical "${vertical}" (looked in ${baked}` +
      `${fromRepo ? ` and ${fromRepo}` : ', no repo checkout detected'})`,
  );
}
