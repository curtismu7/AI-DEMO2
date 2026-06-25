// demo_api_ui/tests/e2e/careconnect-core-chips.real.spec.js
'use strict';
/**
 * CareConnect alias — healthcare vertical core-chip MCP pipeline E2E.
 * Chip list: tests/e2e/helpers/verticalCoreChips.js → E2E_VERTICAL_CORE_PRESETS.healthcare
 *
 *   npm run test:e2e:real:careconnect:core
 */
const { registerVerticalCoreChipTests } = require('./helpers/verticalCoreChipSuite');

registerVerticalCoreChipTests({
  verticalId: 'healthcare',
  suiteTitle: 'CareConnect — core chips full MCP pipeline (heuristic + Helix)',
});
