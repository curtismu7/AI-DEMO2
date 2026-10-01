'use strict';

const recognizeService = require('../../services/recognizeService');

describe('recognizeService contract gate', () => {
  test('reports unconfigured until the tenant Web SDK contract is confirmed', () => {
    expect(recognizeService.isConfigured()).toBe(false);
  });

  test.each([
    ['initiateSession', ['user-123']],
    ['verifySession', ['session-1', { accepted: true }]],
    ['enrollUser', ['user-123']],
    ['enrollFromImage', ['user-123', 'base64-image']],
    ['unenrollUser', ['user-123']],
  ])('%s fails closed without contacting the guessed legacy service', async (method, args) => {
    await expect(recognizeService[method](...args)).rejects.toMatchObject({
      code: 'RECOGNIZE_CONTRACT_UNAVAILABLE',
    });
  });
});
