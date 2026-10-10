import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const contractScript = path.join(repoRoot, 'scripts/check-demo-readiness-contract.mjs');

describe('demo readiness build contract', () => {
  it('accepts the UI lane lists only when all 48 steps map to executable backend behavior', () => {
    const output = execFileSync(
      process.execPath,
      ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', contractScript],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(output).toContain('52 executable Demo Steps entries');
    expect(output).toContain('(29 primary, 5 CIAM, 6 Privilege, 12 Admin)');
    expect(output).toContain('20 provider feature checks are registered separately');
    expect(output).toContain('190 behavior/authorization groups; 758 core rows');
    expect(output).toContain('60 registered provider-feature rows; 822 current rows');
    expect(output).toContain('UI, BFF, and readiness prerequisite flags match for every case and vertical.');
  });
});
