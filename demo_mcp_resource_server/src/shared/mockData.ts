'use strict';

import fs from 'node:fs';
import path from 'node:path';

function findRepoRoot(start: string): string {
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
  throw new Error(`Repo root (banking-demo) not found from ${start}`);
}

export const REPO_ROOT = findRepoRoot(__dirname);

export function loadMockData(vertical: string): Record<string, unknown> {
  const filePath = path.join(REPO_ROOT, 'demo_api_server', 'config', 'verticals', vertical, 'mock-data.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`mock-data.json not found for vertical "${vertical}" at ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}
