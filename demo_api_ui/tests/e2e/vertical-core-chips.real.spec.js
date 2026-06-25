// demo_api_ui/tests/e2e/vertical-core-chips.real.spec.js
'use strict';
/**
 * Generic vertical core-chip E2E — heuristic + Helix through full MCP pipeline.
 *
 * Configure chips in tests/e2e/helpers/verticalCoreChips.js (E2E_VERTICAL_CORE_PRESETS).
 *
 *   E2E_VERTICAL=retail npm run test:e2e:real:vertical:core
 *   E2E_VERTICAL=workforce npm run test:e2e:real:vertical:core
 *
 * Requires: ./run.sh up, E2E_CUSTOMER_* + E2E_ADMIN_* in tests/e2e/.env.e2e
 */
const { registerVerticalCoreChipTests } = require('./helpers/verticalCoreChipSuite');
const { resolveE2eVerticalId } = require('./helpers/verticalCoreChips');

const verticalId = resolveE2eVerticalId();

registerVerticalCoreChipTests({
  verticalId,
  suiteTitle: `${verticalId} — core chips full MCP pipeline (heuristic + Helix)`,
});
