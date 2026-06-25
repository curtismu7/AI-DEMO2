'use strict';

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const config = {
      pingone_environment_id: 'test-env-id',
      pingone_region: 'com',
      pingone_worker_token_client_id: 'worker-client-id',
      pingone_worker_token_client_secret: 'worker-secret',
    };
    return config[key] || null;
  }),
}));

describe('pingOneSessionService', () => {
  let axios;
  let getUserSessions, terminateUserSessions, terminateAllUserSessions;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    axios = require('axios');
    axios.post = jest.fn().mockResolvedValue({
      data: { access_token: 'worker-token', expires_in: 3600 },
    });
    ({ getUserSessions, terminateUserSessions, terminateAllUserSessions } =
      require('../../services/pingOneSessionService'));
  });

  describe('getUserSessions', () => {
    it('returns sessions array for a user', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: {
          _embedded: {
            sessions: [
              { id: 'session-1', createdAt: '2026-01-01T00:00:00Z' },
              { id: 'session-2', createdAt: '2026-01-01T01:00:00Z' },
            ],
          },
        },
      });

      const sessions = await getUserSessions('user-123');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe('session-1');
      expect(axios.get).toHaveBeenCalledWith(
        'https://api.pingone.com/v1/environments/test-env-id/users/user-123/sessions',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer worker-token' }) })
      );
    });

    it('returns empty array when user has no sessions', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { _embedded: { sessions: [] } },
      });
      const sessions = await getUserSessions('user-123');
      expect(sessions).toEqual([]);
    });

    it('returns empty array on 404 (no active sessions)', async () => {
      const err = new Error('Not Found');
      err.response = { status: 404 };
      axios.get = jest.fn().mockRejectedValue(err);
      const sessions = await getUserSessions('user-123');
      expect(sessions).toEqual([]);
    });

    it('returns empty array when userId is falsy', async () => {
      const sessions = await getUserSessions(null);
      expect(sessions).toEqual([]);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });

  describe('terminateUserSessions', () => {
    it('deletes each session and returns count', async () => {
      axios.delete = jest.fn().mockResolvedValue({ status: 204 });

      const result = await terminateUserSessions('user-123', ['session-1', 'session-2']);
      expect(result.terminated).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(axios.delete).toHaveBeenCalledTimes(2);
    });

    it('counts failures but does not throw', async () => {
      axios.delete = jest.fn()
        .mockResolvedValueOnce({ status: 204 })
        .mockRejectedValueOnce(new Error('network error'));

      const result = await terminateUserSessions('user-123', ['session-1', 'session-2']);
      expect(result.terminated).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('returns zero when no session ids provided', async () => {
      axios.delete = jest.fn();
      const result = await terminateUserSessions('user-123', []);
      expect(result.terminated).toBe(0);
      expect(axios.delete).not.toHaveBeenCalled();
    });
  });

  describe('terminateAllUserSessions', () => {
    it('reads sessions then terminates all of them', async () => {
      axios.get = jest.fn().mockResolvedValue({
        status: 200,
        data: { _embedded: { sessions: [{ id: 'session-1' }, { id: 'session-2' }] } },
      });
      axios.delete = jest.fn().mockResolvedValue({ status: 204 });

      const result = await terminateAllUserSessions('user-123');
      expect(result.sessions_found).toBe(2);
      expect(result.terminated).toBe(2);
    });

    it('returns zeros when userId is falsy', async () => {
      const result = await terminateAllUserSessions(null);
      expect(result.sessions_found).toBe(0);
      expect(result.terminated).toBe(0);
      expect(axios.get).not.toHaveBeenCalled();
    });
  });
});
