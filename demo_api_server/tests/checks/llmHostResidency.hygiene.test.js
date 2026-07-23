// demo_api_server/tests/checks/llmHostResidency.hygiene.test.js
'use strict';

const path = require('path');
const { main } = require(path.join(__dirname, '../../../scripts/check-llm-host-residency.js'));

describe('check-llm-host-residency hygiene', () => {
  test('passes against the repo wiring (host bind + residency)', () => {
    expect(main()).toBe(0);
  });
});
