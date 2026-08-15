'use strict';
jest.mock('../../data/serverInventory', () => ({
  SERVER_INVENTORY: [
    { key: 'api', name: 'API', probe: true, healthPath: '/health', candidates: ['http://api:1'] },
    { key: 'self', name: 'Self', probe: 'self' },
    { key: 'gw', name: 'Gateway', probe: true, healthPath: '/health', candidates: ['http://gw:2'] },
    { key: 'opt', name: 'Optional Agent', probe: true, optional: true, healthPath: '/health', candidates: ['http://opt:3'] },
  ],
}));
const axios = require('axios');
jest.mock('axios');

const { run } = require('../../services/checks/serversCheck');

describe('serversCheck', () => {
  afterEach(() => jest.clearAllMocks());

  test('pass when all probed services are up', async () => {
    axios.get.mockResolvedValue({ status: 200 });
    const r = await run({});
    expect(r.status).toBe('pass');
    expect(r.meta.services.find((s) => s.key === 'api').up).toBe(true);
    expect(r.meta.services.find((s) => s.key === 'self').up).toBe(true); // probe:'self' assumed up
  });

  test('fail lists the down service', async () => {
    axios.get.mockImplementation((url) =>
      url.includes('gw') ? Promise.reject({ code: 'ECONNREFUSED' }) : Promise.resolve({ status: 200 }));
    const r = await run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/Gateway/);
    expect(r.meta.services.find((s) => s.key === 'gw').up).toBe(false);
  });

  // "18/21 up" read as three failures on the live page while this check's own
  // status was warn and its detail correctly called the three expected-absent.
  // Optional services belong beside the count, never inside its denominator.
  test('headline counts required services only', async () => {
    axios.get.mockImplementation((url) =>
      url.includes('opt') ? Promise.reject({ code: 'ECONNREFUSED' }) : Promise.resolve({ status: 200 }));
    const r = await run({});
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/^3\/3 required up \(optional 0\/1\)/);
    expect(r.detail).not.toMatch(/3\/4/);
    expect(r.detail).toMatch(/Not started \(optional\): Optional Agent/);
    expect(r.meta.counts).toEqual({
      requiredUp: 3, requiredProbed: 3, optionalUp: 0, optionalProbed: 1,
    });
  });

  test('a required service down still shows in the required count', async () => {
    axios.get.mockImplementation((url) =>
      url.includes('gw') ? Promise.reject({ code: 'ECONNREFUSED' }) : Promise.resolve({ status: 200 }));
    const r = await run({});
    expect(r.detail).toMatch(/^2\/3 required up/);
  });

  test('non-2xx response marks a non-acceptAnyStatus service down', async () => {
    // Entries without acceptAnyStatus pass no validateStatus, so real axios
    // rejects on a 500 — simulate that rejection behavior in the mock.
    axios.get.mockImplementation((url) =>
      url.includes('gw')
        ? Promise.reject({ response: { status: 500 } })
        : Promise.resolve({ status: 200 }));
    const r = await run({});
    expect(r.status).toBe('fail');
    expect(r.meta.services.find((s) => s.key === 'gw').up).toBe(false);
  });
});
