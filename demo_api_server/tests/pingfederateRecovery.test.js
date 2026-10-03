const express = require('express');
const request = require('supertest');

jest.mock('../services/configStore', () => ({ setConfig: jest.fn().mockResolvedValue() }));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/pingfederateReachability', () => ({ isPingFederateDown: jest.fn() }));
jest.mock('fs', () => ({ ...jest.requireActual('fs'), existsSync: jest.fn() }));
jest.mock('http', () => ({ ...jest.requireActual('http'), request: jest.fn() }));

const fs = require('fs');
const http = require('http');
const configStore = require('../services/configStore');
const { isPingFederateDown } = require('../services/pingfederateReachability');
const router = require('../routes/pingfederateRecovery');

const app = express();
app.use(express.json());
app.use('/api/auth/pingfederate', router);

const realRequest = jest.requireActual('http').request;

// Fake only the docker-socket call; supertest's own requests must reach the real http.
function dockerAnswers(statusCode) {
  http.request.mockImplementation((...args) => {
    if (!args[0] || !args[0].socketPath) return realRequest(...args);
    const req = {
      once: () => req,
      end: () => args[1]({ statusCode, resume: () => {} }),
      destroy: () => {},
    };
    return req;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  dockerAnswers(204);
});

describe('POST /start', () => {
  it('404s where there is no docker socket (k8s / SE AWS)', async () => {
    fs.existsSync.mockReturnValue(false);
    const res = await request(app).post('/api/auth/pingfederate/start');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_available');
    expect(http.request.mock.calls.some(([o]) => o && o.socketPath)).toBe(false);
  });

  it('starts only the fixed container, whatever the request says', async () => {
    fs.existsSync.mockReturnValue(true);
    dockerAnswers(204);
    const res = await request(app).post('/api/auth/pingfederate/start').send({ name: 'ai-demo-api-server' });
    expect(res.body).toEqual({ ok: true });
    const dockerCall = http.request.mock.calls.find(([o]) => o && o.socketPath);
    expect(dockerCall[0].path).toBe('/containers/ai-demo-pingfederate/start');
  });

  it('treats 304 (already running) as ok and 404 as container_missing', async () => {
    fs.existsSync.mockReturnValue(true);
    dockerAnswers(304);
    expect((await request(app).post('/api/auth/pingfederate/start')).body).toEqual({ ok: true });
    dockerAnswers(404);
    const missing = await request(app).post('/api/auth/pingfederate/start');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('container_missing');
  });
});

describe('POST /use-pingone', () => {
  it('switches the provider to pingone only while PF is down', async () => {
    isPingFederateDown.mockResolvedValue(true);
    const res = await request(app).post('/api/auth/pingfederate/use-pingone').send({ OAUTH_PROVIDER: 'evil' });
    expect(res.body).toEqual({ ok: true });
    expect(configStore.setConfig).toHaveBeenCalledWith({ OAUTH_PROVIDER: 'pingone' });
  });

  it('refuses with 409 and changes nothing while PF is reachable', async () => {
    isPingFederateDown.mockResolvedValue(false);
    const res = await request(app).post('/api/auth/pingfederate/use-pingone');
    expect(res.status).toBe(409);
    expect(configStore.setConfig).not.toHaveBeenCalled();
  });
});

describe('GET /status', () => {
  it('reports whether PF is down', async () => {
    isPingFederateDown.mockResolvedValue(true);
    expect((await request(app).get('/api/auth/pingfederate/status')).body).toEqual({ down: true });
  });
});
