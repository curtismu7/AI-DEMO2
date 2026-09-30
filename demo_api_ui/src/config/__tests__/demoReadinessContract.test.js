import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const contractScript = path.join(repoRoot, 'scripts/check-demo-readiness-contract.mjs');

describe('demo readiness build contract', () => {
  it('accepts the UI lane lists only when all 47 steps map to executable backend behavior', () => {
    const output = execFileSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', contractScript],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(output).toContain('47 executable Demo Steps entries');
    expect(output).toContain('(25 primary, 4 CIAM, 6 Privilege, 12 Admin)');
    expect(output).toContain('21 provider feature checks are registered separately');
    expect(output).toContain('185 behavior/authorization groups; 738 core rows');
    expect(output).toContain('62 registered provider-feature rows; 804 current rows');
    expect(output).toContain('UI, BFF, and readiness prerequisite flags match for every case and vertical.');
  });
});
