/**
 * @file weatherBridgeRewrite.test.js
 * Bridge maps Agent/BFF get_weather → third-party get_current_conditions.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('demo_mcp_weather bridge rewrite', () => {
  it('rewrites tools/call get_weather to get_current_conditions', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../demo_mcp_weather/server.js'),
      'utf8'
    );
    expect(src).toMatch(/params\.name === 'get_weather'/);
    expect(src).toMatch(/name: 'get_current_conditions'/);
  });
});
