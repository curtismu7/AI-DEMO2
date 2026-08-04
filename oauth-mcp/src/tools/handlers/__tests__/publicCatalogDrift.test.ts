/**
 * Cross-copy drift guard: the public catalog exists twice on purpose — here
 * (real MCP server path) and in the BFF's local fallback
 * (demo_api_server/data/publicBranchCatalog.js). The 2026-08-04 regression
 * shipped because one copy was fixed and the other was not. The copies must
 * stay byte-identical per vertical, and cover the same vertical set.
 */
import { CATALOG_BY_VERTICAL } from '../publicCatalogHandlers';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bff = require('../../../../../demo_api_server/data/publicBranchCatalog.js');

describe('public catalog — MCP server copy matches the BFF fallback copy', () => {
  test('same vertical ids in both copies', () => {
    expect(Object.keys(CATALOG_BY_VERTICAL).sort()).toEqual(
      Object.keys(bff.CATALOG_BY_VERTICAL).sort(),
    );
  });

  test.each(Object.keys(CATALOG_BY_VERTICAL))('vertical "%s" entries identical', (vertical) => {
    // JSON round-trip strips Object.freeze and prototype differences.
    expect(JSON.parse(JSON.stringify(CATALOG_BY_VERTICAL[vertical]))).toEqual(
      JSON.parse(JSON.stringify(bff.CATALOG_BY_VERTICAL[vertical])),
    );
  });
});
