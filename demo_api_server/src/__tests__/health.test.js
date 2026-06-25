/**
 * Tests for Health Endpoints
 */

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const healthRouter = require('../../routes/health');

jest.mock('axios');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

describe('Health Endpoints', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/health', healthRouter);
    jest.clearAllMocks();
  });

  describe('GET /health/live', () => {
    it('should return 200 with alive status', async () => {
      const response = await request(app)
        .get('/health/live')
        .expect(200);

      expect(response.body.status).toBe('alive');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('GET /health/ready', () => {
    beforeEach(() => {
      process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/jwks';
      process.env.MCP_SERVER_URL = 'http://localhost:8080';
    });

    afterEach(() => {
      delete process.env.PINGONE_JWKS_URI;
      delete process.env.MCP_SERVER_URL;
    });

    it('should return 200 when all dependencies healthy', async () => {
      axios.get.mockResolvedValue({ status: 200, data: {} });

      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body.status).toBe('ready');
      expect(response.body.checks).toBeDefined();
      expect(response.body.checks.pingone_jwks.status).toBe('healthy');
    });

    it('should return 503 when PingOne JWKS unreachable', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));

      const response = await request(app)
        .get('/health/ready')
        .expect(503);

      expect(response.body.status).toBe('not_ready');
      expect(response.body.checks.pingone_jwks.status).toBe('unhealthy');
    });

    it('should handle missing JWKS URI configuration', async () => {
      delete process.env.PINGONE_JWKS_URI;

      const response = await request(app)
        .get('/health/ready');

      expect(response.body.checks.pingone_jwks.status).toBe('not_configured');
    });

    it('should include response times for healthy checks', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health/ready')
        .expect(200);

      expect(response.body.checks.pingone_jwks.responseTime).toBeDefined();
      expect(typeof response.body.checks.pingone_jwks.responseTime).toBe('number');
    });

    it('should check database health if available', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health/ready');

      expect(response.body.checks.database).toBeDefined();
    });

    it('should check session store health', async () => {
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health/ready');

      expect(response.body.checks.session_store).toBeDefined();
      expect(response.body.checks.session_store.status).toBe('healthy');
    });
  });

  describe('GET /health', () => {
    beforeEach(() => {
      process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/token';
      process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/jwks';
      process.env.PINGONE_INTROSPECTION_ENDPOINT = 'https://auth.pingone.com/introspect';
      process.env.PINGONE_REVOCATION_ENDPOINT = 'https://auth.pingone.com/revoke';
      process.env.CIBA_ENABLED = 'true';
    });

    afterEach(() => {
      delete process.env.PINGONE_TOKEN_ENDPOINT;
      delete process.env.PINGONE_JWKS_URI;
      delete process.env.PINGONE_INTROSPECTION_ENDPOINT;
      delete process.env.PINGONE_REVOCATION_ENDPOINT;
      delete process.env.CIBA_ENABLED;
    });

    it('should return detailed health status', async () => {
      axios.post.mockResolvedValue({ status: 400 }); // Token endpoint returns 400 for missing params
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.version).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(response.body.memory).toBeDefined();
      expect(response.body.components).toBeDefined();
    });

    it('should check all components', async () => {
      axios.post.mockResolvedValue({ status: 400 });
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health');

      expect(response.body.components.pingone_auth).toBeDefined();
      expect(response.body.components.pingone_jwks).toBeDefined();
      expect(response.body.components.token_introspection).toBeDefined();
      expect(response.body.components.token_revocation).toBeDefined();
      expect(response.body.components.ciba).toBeDefined();
    });

    it('should return degraded status if any component unhealthy', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('degraded');
    });

    it('should show configured endpoints', async () => {
      axios.post.mockResolvedValue({ status: 400 });
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health');

      expect(response.body.components.token_introspection.status).toBe('configured');
      expect(response.body.components.token_introspection.endpoint).toBe('https://auth.pingone.com/introspect');
    });

    it('should show CIBA status', async () => {
      axios.post.mockResolvedValue({ status: 400 });
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health');

      expect(response.body.components.ciba.status).toBe('enabled');
    });

    it('should show CIBA disabled when not enabled', async () => {
      process.env.CIBA_ENABLED = 'false';
      axios.post.mockResolvedValue({ status: 400 });
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health');

      expect(response.body.components.ciba.status).toBe('disabled');
    });

    it('should include memory usage', async () => {
      axios.post.mockResolvedValue({ status: 400 });
      axios.get.mockResolvedValue({ status: 200 });

      const response = await request(app)
        .get('/health');

      expect(response.body.memory.rss).toBeDefined();
      expect(response.body.memory.heapTotal).toBeDefined();
      expect(response.body.memory.heapUsed).toBeDefined();
    });
  });

  describe('GET /health/startup', () => {
    beforeEach(() => {
      process.env.PINGONE_ENVIRONMENT_ID = 'test-env-id';
      process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.pingone.com/token';
    });

    afterEach(() => {
      delete process.env.PINGONE_ENVIRONMENT_ID;
      delete process.env.PINGONE_TOKEN_ENDPOINT;
    });

    it('should return 200 when all required config present', async () => {
      const response = await request(app)
        .get('/health/startup')
        .expect(200);

      expect(response.body.status).toBe('started');
      expect(response.body.timestamp).toBeDefined();
    });

    it('should return 503 when required config missing', async () => {
      delete process.env.PINGONE_ENVIRONMENT_ID;

      const response = await request(app)
        .get('/health/startup')
        .expect(503);

      expect(response.body.status).toBe('not_started');
      expect(response.body.missing_config).toContain('PINGONE_ENVIRONMENT_ID');
    });

    it('should list all missing config', async () => {
      delete process.env.PINGONE_ENVIRONMENT_ID;
      delete process.env.PINGONE_TOKEN_ENDPOINT;

      const response = await request(app)
        .get('/health/startup')
        .expect(503);

      expect(response.body.missing_config).toHaveLength(2);
      expect(response.body.missing_config).toContain('PINGONE_ENVIRONMENT_ID');
      expect(response.body.missing_config).toContain('PINGONE_TOKEN_ENDPOINT');
    });
  });
});
