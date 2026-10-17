'use strict';
// PingOne renames a device with PUT /users/{id}/devices/{deviceId}/nickname.
// A PATCH on the device itself is not a route; PingOne's edge answers 403.

jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: (k) => ({ pingone_environment_id: 'env', pingone_worker_token_client_id: 'id', pingone_worker_token_client_secret: 'sec' })[k] || null }));

const axios = require('axios');
const mfaService = require('../services/mfaService');

test('updateDeviceNickname PUTs the nickname sub-resource', async () => {
  axios.post.mockResolvedValue({ data: { access_token: 't', expires_in: 3600 } });
  axios.put.mockResolvedValue({ data: { id: 'd1', nickname: 'Work phone' } });
  await expect(mfaService.updateDeviceNickname('u1', 'd1', 'Work phone')).resolves.toEqual({ id: 'd1', nickname: 'Work phone' });
  expect(axios.put).toHaveBeenCalledWith(expect.stringMatching(/\/users\/u1\/devices\/d1\/nickname$/), { nickname: 'Work phone' }, expect.anything());
});
