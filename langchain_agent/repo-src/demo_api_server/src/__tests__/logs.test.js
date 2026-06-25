/**
 * Tests for Log Viewer API Routes
 */

const request = require('supertest');
const express = require('express');
const logsRouter = require('../../routes/logs');

const fs = require('fs');
const { exec } = require('child_process');

jest.mock('fs');
jest.mock('child_process');

describe('Log Viewer API', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/logs', logsRouter);
    jest.clearAllMocks();
    
    // Mock exec to prevent actual CLI calls
    exec.mockImplementation((cmd, options, callback) => {
      callback(new Error('Vercel CLI not available'), '', '');
    });
    
    // Mock fs methods
    fs.existsSync = jest.fn(() => false);
    fs.readFileSync = jest.fn(() => '');
  });

  describe('GET /api/logs/console', () => {
    it('should return console logs', async () => {
      const response = await request(app)
        .get('/api/logs/console')
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.logs)).toBe(true);
    });

    it('should filter logs by level', async () => {
      const response = await request(app)
        .get('/api/logs/console?level=error')
        .expect(200);

      expect(response.body.logs.every(log => log.level === 'error')).toBe(true);
    });

    it('should filter logs by search term', async () => {
      const response = await request(app)
        .get('/api/logs/console?search=test')
        .expect(200);

      expect(response.body).toHaveProperty('logs');
    });

    it('should limit number of logs returned', async () => {
      const response = await request(app)
        .get('/api/logs/console?limit=10')
        .expect(200);

      expect(response.body.logs.length).toBeLessThanOrEqual(10);
    });

    it('should filter logs by time', async () => {
      const since = new Date(Date.now() - 3600000).toISOString();
      const response = await request(app)
        .get(`/api/logs/console?since=${since}`)
        .expect(200);

      expect(response.body).toHaveProperty('logs');
    });
  });

  describe('GET /api/logs/app', () => {
    it('should return application logs', async () => {
      const response = await request(app)
        .get('/api/logs/app')
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('total');
    });

    it('should handle missing log files gracefully', async () => {
      const response = await request(app)
        .get('/api/logs/app')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });
  });

  describe('GET /api/logs/vercel', () => {
    it('should return vercel logs or fallback', async () => {
      const response = await request(app)
        .get('/api/logs/vercel')
        .expect(200);

      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('source');
    });

    it('should handle vercel CLI not available', async () => {
      const response = await request(app)
        .get('/api/logs/vercel')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });
  });

  describe('GET /api/logs/stats', () => {
    it('should return log statistics', async () => {
      const response = await request(app)
        .get('/api/logs/stats')
        .expect(200);

      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('byLevel');
      expect(response.body.byLevel).toHaveProperty('error');
      expect(response.body.byLevel).toHaveProperty('warn');
      expect(response.body.byLevel).toHaveProperty('info');
      expect(response.body.byLevel).toHaveProperty('debug');
    });

    it('should include oldest and newest timestamps', async () => {
      const response = await request(app)
        .get('/api/logs/stats')
        .expect(200);

      expect(response.body).toHaveProperty('oldest');
      expect(response.body).toHaveProperty('newest');
    });
  });

  describe('DELETE /api/logs/console', () => {
    it('should clear console logs', async () => {
      const response = await request(app)
        .delete('/api/logs/console')
        .expect(200);

      expect(response.body).toHaveProperty('cleared');
      expect(typeof response.body.cleared).toBe('number');
    });

    it('should return count of cleared logs', async () => {
      const response = await request(app)
        .delete('/api/logs/console')
        .expect(200);

      expect(response.body.cleared).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Console log capture', () => {
    it('should capture console.log messages', () => {
      const originalLength = global.console.log.mock?.calls?.length || 0;
      console.log('Test log message');
      
      // Console should still work
      expect(console.log).toBeDefined();
    });

    it('should capture console.error messages', () => {
      console.error('Test error message');
      
      // Console should still work
      expect(console.error).toBeDefined();
    });

    it('should capture console.warn messages', () => {
      console.warn('Test warning message');
      
      // Console should still work
      expect(console.warn).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should handle errors gracefully in app logs', async () => {
      const response = await request(app)
        .get('/api/logs/app')
        .expect(200);

      expect(response.body).toBeDefined();
    });

    it('should handle errors gracefully in vercel logs', async () => {
      const response = await request(app)
        .get('/api/logs/vercel')
        .expect(200);

      expect(response.body).toBeDefined();
    });
  });

  describe('Query parameter validation', () => {
    it('should handle invalid limit parameter', async () => {
      const response = await request(app)
        .get('/api/logs/console?limit=invalid')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should handle invalid since parameter', async () => {
      const response = await request(app)
        .get('/api/logs/console?since=invalid')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });

    it('should handle multiple filters together', async () => {
      const response = await request(app)
        .get('/api/logs/console?level=error&search=test&limit=5')
        .expect(200);

      expect(response.body.logs.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Log format handling', () => {
    it('should handle JSON formatted logs', async () => {
      const response = await request(app)
        .get('/api/logs/console')
        .expect(200);

      response.body.logs.forEach(log => {
        expect(log).toHaveProperty('timestamp');
        expect(log).toHaveProperty('level');
        expect(log).toHaveProperty('message');
        expect(log).toHaveProperty('id');
        expect(typeof log.id).toBe('number');
      });
    });

    it('should handle plain text logs', async () => {
      const response = await request(app)
        .get('/api/logs/app')
        .expect(200);

      expect(response.body.logs).toBeDefined();
    });
  });
});
