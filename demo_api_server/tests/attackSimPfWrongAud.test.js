'use strict';
/** wrong-aud sim under PingFederate: the AS refusing the exchange IS the denial, not a 502 sim error. */
const { _pfExchangeRefusal } = require('../services/attackSimulatorService').__test;

describe('_pfExchangeRefusal', () => {
  test.each(['unauthorized_client', 'invalid_target'])('PF + %s is a refusal', (code) => {
    expect(_pfExchangeRefusal({ pingoneError: code }, 'pingfederate')).toBe(true);
  });
  test('PingOne keeps the 502 error path', () => {
    expect(_pfExchangeRefusal({ pingoneError: 'unauthorized_client' }, 'pingone')).toBe(false);
  });
  test('PF with an unrelated failure (e.g. server_error) is still an error', () => {
    expect(_pfExchangeRefusal({ pingoneError: 'server_error' }, 'pingfederate')).toBe(false);
    expect(_pfExchangeRefusal(new Error('boom'), 'pingfederate')).toBe(false);
  });
});
