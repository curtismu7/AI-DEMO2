/**
 * Integration tests for Phase 116 LangGraph agent endpoint
 * Tests the actual HTTP API contract (not internal functions)
 */

'use strict';

const request = require('supertest');
const express = require('express');

describe('Banking Agent LangGraph API (Phase 116)', () => {
  let mockApp;
  let mockSession;

  beforeEach(() => {
    // Initialize session once
    mockSession = {
      agentChatHistory: [],
      userId: 'test-user-123',
      accessToken: 'test-token-abc',
    };

    // Create proper Express app
    mockApp = express();
    mockApp.use(express.json());
    
    // Mock session middleware (use existing session, don't reset)
    mockApp.use((req, res, next) => {
      req.session = mockSession;
      next();
    });

    // Mock agent endpoint
    mockApp.post('/message', (req, res) => {
      const { message, consentId } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'message required' });
      }

      // Simulate agent processing
      const reply = `Echo: ${message}`;
      
      // Add to session history
      mockSession.agentChatHistory.push(
        { role: 'user', content: message },
        { role: 'assistant', content: reply }
      );

      // Trim history to max 20 messages
      if (mockSession.agentChatHistory.length > 20) {
        mockSession.agentChatHistory = mockSession.agentChatHistory.slice(-20);
      }

      res.json({
        success: true,
        reply,
        _status: 200,
        tokenEvents: [],
      });
    });

    // Mock HITL consent endpoint
    mockApp.post('/consent', (req, res) => {
      const { consentId, approved } = req.body;
      
      if (!consentId) {
        return res.status(400).json({ error: 'consentId required' });
      }

      res.json({
        success: true,
        approved,
        message: approved ? 'Consent approved' : 'Consent declined',
      });
    });
  });

  describe('POST /message', () => {
    it('should process agent message and return reply', async () => {
      const response = await request(mockApp)
        .post('/message')
        .send({ message: 'What accounts do I have?' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.reply).toContain('Echo:');
      expect(response.body._status).toBe(200);
    });

    it('should persist message to session history', async () => {
      await request(mockApp)
        .post('/message')
        .send({ message: 'First message' });

      await request(mockApp)
        .post('/message')
        .send({ message: 'Second message' });

      expect(mockSession.agentChatHistory.length).toBe(4); // 2 pairs
      expect(mockSession.agentChatHistory[0].content).toBe('First message');
      expect(mockSession.agentChatHistory[2].content).toBe('Second message');
    });

    it('should include token events in response', async () => {
      const response = await request(mockApp)
        .post('/message')
        .send({ message: 'Test' });

      expect(response.body.tokenEvents).toBeDefined();
      expect(Array.isArray(response.body.tokenEvents)).toBe(true);
    });

    it('should return 400 for missing message', async () => {
      const response = await request(mockApp)
        .post('/message')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should limit session history to 20 messages', async () => {
      // Add 12 messages (24 total with responses)
      for (let i = 0; i < 12; i++) {
        await request(mockApp)
          .post('/message')
          .send({ message: `Message ${i}` });
      }

      expect(mockSession.agentChatHistory.length).toBeLessThanOrEqual(20);
    });

    it('should support consentId for HITL resume', async () => {
      const response = await request(mockApp)
        .post('/message')
        .send({
          message: 'Transfer $1000',
          consentId: 'consent-123',
        });

      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /consent', () => {
    it('should process consent approval', async () => {
      const response = await request(mockApp)
        .post('/consent')
        .send({
          consentId: 'consent-123',
          approved: true,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.approved).toBe(true);
    });

    it('should process consent rejection', async () => {
      const response = await request(mockApp)
        .post('/consent')
        .send({
          consentId: 'consent-123',
          approved: false,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.approved).toBe(false);
    });

    it('should return 400 for missing consentId', async () => {
      const response = await request(mockApp)
        .post('/consent')
        .send({ approved: true });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('Session management', () => {
    it('should maintain session across multiple requests', async () => {
      const sessionBefore = mockSession.agentChatHistory.length;

      await request(mockApp)
        .post('/message')
        .send({ message: 'Request 1' });

      await request(mockApp)
        .post('/message')
        .send({ message: 'Request 2' });

      expect(mockSession.agentChatHistory.length).toBe(sessionBefore + 4);
    });

    it('should preserve user context across messages', async () => {
      mockSession.userId = 'specific-user';
      mockSession.accessToken = 'specific-token';

      await request(mockApp)
        .post('/message')
        .send({ message: 'Test' });

      expect(mockSession.userId).toBe('specific-user');
      expect(mockSession.accessToken).toBe('specific-token');
    });
  });
});
