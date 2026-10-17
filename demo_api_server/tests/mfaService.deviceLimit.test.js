'use strict';
// PingOne refuses a new device past the environment's maxAllowedDevices with
// REQUEST_LIMITED / LIMIT_EXCEEDED ("The request will exceed your limit.").
// Every enrollment path should say what that means and what to do.

jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: (k) => ({ pingone_environment_id: 'env', pingone_worker_token_client_id: 'id', pingone_worker_token_client_secret: 'sec' })[k] || null }));

const axios = require('axios');
const mfaService = require('../services/mfaService');

test('a device-limit refusal becomes code device_limit with an actionable message', async () => {
  axios.post.mockImplementation((url) => (String(url).includes('/as/token')
    ? Promise.resolve({ data: { access_token: 't', expires_in: 3600 } })
    : Promise.reject({ response: { status: 400, data: { code: 'REQUEST_LIMITED', message: 'The request will exceed your limit.', details: [{ code: 'LIMIT_EXCEEDED' }] } } })));
  await expect(mfaService.enrollTotpDevice('u1')).rejects.toMatchObject({
    code: 'device_limit',
    message: expect.stringMatching(/maximum number of MFA devices.*delete one/i),
  });
});
