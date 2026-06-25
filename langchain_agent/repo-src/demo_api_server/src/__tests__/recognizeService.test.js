'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    if (key === 'RECOGNIZE_API_KEY') return 'test-api-key';
    if (key === 'RECOGNIZE_TENANT_NAME') return 'test-tenant';
    if (key === 'RECOGNIZE_BASE_URL') return 'https://auth.example.com';
    return null;
  }),
}));

jest.mock('axios');

const axios = require('axios');
const recognizeService = require('../../services/recognizeService');

describe('recognizeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initiateSession', () => {
    test('calls POST {baseUrl}/v1/customers/{tenantName}/sessions with X-API-Key header and {username} body', async () => {
      axios.post.mockResolvedValue({ data: { sessionToken: 'tok-abc', sessionId: 'sid-1' } });

      const result = await recognizeService.initiateSession('user-123');

      expect(result.sessionToken).toBe('tok-abc');
      expect(result.sessionId).toBe('sid-1');
      expect(axios.post).toHaveBeenCalledWith(
        'https://auth.example.com/v1/customers/test-tenant/sessions',
        expect.objectContaining({ username: 'user-123' }),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-API-Key': 'test-api-key' }),
        }),
      );
    });

    test('returns sessionToken and sessionId from API response', async () => {
      axios.post.mockResolvedValue({ data: { sessionToken: 'tok-xyz', sessionId: 'sid-999' } });

      const result = await recognizeService.initiateSession('user-456');

      expect(result).toEqual({ sessionToken: 'tok-xyz', sessionId: 'sid-999' });
    });

    test('throws with message containing RECOGNIZE_API_KEY when configStore returns null for that key', async () => {
      // Re-require both modules after possible resetModules() in afterEach so both share the same mock
      jest.resetModules();
      jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => null) }));
      jest.mock('axios');
      const freshService = require('../../services/recognizeService');

      await expect(freshService.initiateSession('user-123')).rejects.toThrow('RECOGNIZE_API_KEY');
    });
  });

  describe('verifySession', () => {
    beforeEach(() => {
      // Restore default mock so config is available
      const configStore = require('../../services/configStore');
      configStore.getEffective.mockImplementation((key) => {
        if (key === 'RECOGNIZE_API_KEY') return 'test-api-key';
        if (key === 'RECOGNIZE_TENANT_NAME') return 'test-tenant';
        if (key === 'RECOGNIZE_BASE_URL') return 'https://auth.example.com';
        return null;
      });
    });

    test('returns true when API returns status: ACCEPTED', async () => {
      axios.post.mockResolvedValue({ data: { status: 'ACCEPTED' } });

      const ok = await recognizeService.verifySession('sid-1', { sessionId: 'sid-1' });

      expect(ok).toBe(true);
    });

    test('returns false when API returns status: REJECTED', async () => {
      axios.post.mockResolvedValue({ data: { status: 'REJECTED' } });

      const ok = await recognizeService.verifySession('sid-1', { sessionId: 'sid-1' });

      expect(ok).toBe(false);
    });

    test('returns false for any non-ACCEPTED status', async () => {
      axios.post.mockResolvedValue({ data: { status: 'PENDING' } });

      const ok = await recognizeService.verifySession('sid-1', {});

      expect(ok).toBe(false);
    });
  });

  describe('enrollUser', () => {
    test('calls POST .../enrollments endpoint without throwing', async () => {
      axios.post.mockResolvedValue({ data: { status: 'ENROLLED' } });

      await expect(recognizeService.enrollUser('user-123')).resolves.not.toThrow();

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/enrollments'),
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('enrollFromImage', () => {
    test('calls POST .../enrollments with { image: base64, scenario: TRUSTED_SOURCE }', async () => {
      axios.post.mockResolvedValue({ data: { status: 'ENROLLED' } });

      await expect(
        recognizeService.enrollFromImage('user-123', 'base64data', 'TRUSTED_SOURCE'),
      ).resolves.not.toThrow();

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/enrollments'),
        expect.objectContaining({ image: 'base64data', scenario: 'TRUSTED_SOURCE' }),
        expect.any(Object),
      );
    });

    test('defaults scenario to TRUSTED_SOURCE when not provided', async () => {
      axios.post.mockResolvedValue({ data: { status: 'ENROLLED' } });

      await recognizeService.enrollFromImage('user-123', 'base64data');

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ scenario: 'TRUSTED_SOURCE' }),
        expect.any(Object),
      );
    });
  });

  describe('unenrollUser', () => {
    test('calls DELETE .../enrollments/{userId} without throwing', async () => {
      axios.delete.mockResolvedValue({ data: {} });

      await expect(recognizeService.unenrollUser('user-123')).resolves.not.toThrow();

      expect(axios.delete).toHaveBeenCalledWith(
        expect.stringContaining('/enrollments/user-123'),
        expect.any(Object),
      );
    });
  });
});
