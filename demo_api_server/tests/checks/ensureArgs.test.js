// demo_api_server/tests/checks/ensureArgs.test.js
'use strict';

const { parseResidentPorts, resolveEnsureArgs } = require('../../../demo_llm_proxy/ensureArgs');

describe('resolveEnsureArgs', () => {
  test('classic swap without residency uses ensure <port>', () => {
    expect(resolveEnsureArgs(8096, '')).toEqual(['ensure', '8096']);
    expect(resolveEnsureArgs('8091')).toEqual(['ensure', '8091']);
  });

  test('residency uses ensure-set and keeps resident ports when swapping up', () => {
    // Regression: ensure 8096 alone killed phi (:8091) while BFF still pinned it.
    expect(resolveEnsureArgs(8096, '8091,8096')).toEqual(['ensure-set', '8091,8096']);
    expect(resolveEnsureArgs(8091, '8091,8096')).toEqual(['ensure-set', '8091,8096']);
  });

  test('requested port is added if missing from resident set', () => {
    expect(resolveEnsureArgs(8093, '8091')).toEqual(['ensure-set', '8091,8093']);
  });

  test('parseResidentPorts ignores junk', () => {
    expect(parseResidentPorts('8091, ,bogus,8096')).toEqual(['8091', '8096']);
  });
});
