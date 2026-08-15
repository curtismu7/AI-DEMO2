// demo_api_server/tests/intentToken.sportingGoodsCart.regression.test.js
//
// Regression: browse_gear/add_to_cart were added to sporting-goods'
// tools.js/manifest.json but never mirrored into the intent-token maps
// (_TOOL_TO_INTENT in server.js, INTENT_TO_PERMITTED_TOOLS/READ_ONLY_TOOLS/
// READ_ONLY_TOOLS_BY_VERTICAL here). A minted Intent Token for either tool
// fell back to the sporting-goods read-only list, which never contained
// add_to_cart, so PingGateway P1AZ would DENY it with intent_mismatch.

const {
  permittedToolsForIntent,
  READ_ONLY_TOOLS,
} = require('../services/intentTokenService');

describe('intent token — sporting-goods browse_gear/add_to_cart are mirrored', () => {
  test('browse_gear intent permits browse_gear', () => {
    expect(permittedToolsForIntent('browse_gear', 'sporting-goods')).toContain('browse_gear');
  });

  test('add_to_cart intent permits add_to_cart', () => {
    expect(permittedToolsForIntent('add_to_cart', 'sporting-goods')).toContain('add_to_cart');
  });

  test('browse_gear is read-only (global list)', () => {
    expect(READ_ONLY_TOOLS).toContain('browse_gear');
  });

  test('add_to_cart is a write — never in the global read-only list', () => {
    expect(READ_ONLY_TOOLS).not.toContain('add_to_cart');
  });

  test('an unclassified sporting-goods prompt can reach browse_gear but not add_to_cart', () => {
    const permitted = permittedToolsForIntent('unknown', 'sporting-goods');
    expect(permitted).toContain('browse_gear');
    expect(permitted).not.toContain('add_to_cart');
  });
});
