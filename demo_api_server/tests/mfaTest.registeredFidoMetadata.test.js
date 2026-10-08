'use strict';
/**
 * GET /integration/fido2-metadata reads the lookup ID off the user's registered
 * FIDO2 device. PingOne puts it at device.fidoDeviceMetadata.mdsIdentifier.
 */
const request = require('supertest');
const express = require('express');

jest.mock('../services/mfaService', () => ({
  listMfaDevices: jest.fn(),
  getFidoDeviceMetadata: jest.fn(),
}));
jest.mock('../services/oauthService', () => ({}));
jest.mock('../services/apiCallTrackerService', () => ({ track: jest.fn() }));
jest.mock('../utils/mfaLogger', () => ({ mfaLogger: { logOperation: jest.fn() } }));
jest.mock('../middleware/auth', () => ({
  authenticateToken: (_req, _res, next) => next(),
}));

const mfaService = require('../services/mfaService');
const router = require('../routes/mfaTest');

const MDS = 'adce0002-35bc-c60a-648b-0b25f1f05503';

function buildApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = {
      user: { oauthId: 'user-uuid' },
      oauthTokens: { accessToken: 'stub' },
      save: (cb) => cb && cb(),
    };
    next();
  });
  app.use('/api/mfa/test', router);
  return app;
}

describe('GET /integration/fido2-metadata (registered device)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('looks up metadata by fidoDeviceMetadata.mdsIdentifier', async () => {
    mfaService.listMfaDevices.mockResolvedValue({
      devices: [{ type: 'FIDO2', fidoDeviceMetadata: { mdsIdentifier: MDS } }],
    });
    mfaService.getFidoDeviceMetadata.mockResolvedValue({
      metadata: { aaguid: MDS },
      _debug: { request: { method: 'GET', endpoint: 'u' }, response: { aaguid: MDS } },
    });

    const res = await request(buildApp()).get('/api/mfa/test/integration/fido2-metadata');

    expect(res.status).toBe(200);
    expect(mfaService.getFidoDeviceMetadata).toHaveBeenCalledWith(MDS);
    expect(res.body.aaguid).toBe(MDS);
  });

  test('422s with the device field names when the record carries no UUID', async () => {
    mfaService.listMfaDevices.mockResolvedValue({ devices: [{ type: 'FIDO2', id: 'x' }] });

    const res = await request(buildApp()).get('/api/mfa/test/integration/fido2-metadata');

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('no_aaguid_on_device');
    expect(res.body.deviceFields).toEqual(['type', 'id']);
    expect(mfaService.getFidoDeviceMetadata).not.toHaveBeenCalled();
  });
});
