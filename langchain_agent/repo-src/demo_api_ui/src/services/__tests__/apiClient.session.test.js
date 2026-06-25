/**
 * Focused apiClient tests (session token path; getTokenFromSession uses axios.get, not client.get).
 */
/* eslint-disable import/first -- jest.mock must run before axios import */

vi.mock('axios', () => {
  const sharedGet = jest.fn();
  const sharedPost = jest.fn();
  const mockClient = {
    get: sharedGet,
    post: sharedPost,
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockClient),
      get: sharedGet,
      post: sharedPost,
      defaults: { headers: { common: {} } },
    },
  };
});

import axios from 'axios';
import apiClient from '../apiClient';

const mockClient = axios.create.mock.results[0].value;
const sharedGet = mockClient.get;
const sharedPost = mockClient.post;

/** Captured at module load so assertions survive jest.restoreAllMocks() between tests */
const axiosCreateOptions = axios.create.mock.calls[0][0];

// Index 0 = spinner interceptor, index 1 = traffic-stamp, index 2 = auth token
const requestInterceptorFn =
  mockClient.interceptors.request.use.mock.calls[2] &&
  mockClient.interceptors.request.use.mock.calls[2][0];

const responseInterceptorFn =
  mockClient.interceptors.response.use.mock.calls[0] &&
  mockClient.interceptors.response.use.mock.calls[0][1];

describe('apiClient session OAuth', () => {
  beforeEach(() => {
    sharedGet.mockReset();
    sharedPost.mockReset();
    mockClient.defaults.headers.common = {};
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('getTokenFromSession returns accessToken from user status', async () => {
    sharedGet.mockResolvedValueOnce({
      data: {
        authenticated: true,
        accessToken: 'oauth-access-token-123',
        tokenType: 'Bearer',
        expiresAt: Date.now() + 3600000,
        user: { id: 'u1', username: 'u', email: 'u@test.com' },
      },
    });

    const token = await apiClient.getTokenFromSession();

    expect(token).toBe('oauth-access-token-123');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/user/status');
  });

  it('getTokenFromSession falls back to admin status when user is not authenticated', async () => {
    sharedGet
      .mockResolvedValueOnce({
        data: { authenticated: false },
      })
      .mockResolvedValueOnce({
        data: {
          authenticated: true,
          accessToken: 'admin-token',
          tokenType: 'Bearer',
          expiresAt: Date.now() + 3600000,
          user: { id: 'a1', username: 'admin', role: 'admin' },
        },
      });

    const token = await apiClient.getTokenFromSession();

    expect(token).toBe('admin-token');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/user/status');
    expect(sharedGet).toHaveBeenCalledWith('/api/auth/oauth/status');
  });

  it('request interceptor adds Bearer when getValidToken resolves', async () => {
    expect(requestInterceptorFn).toEqual(expect.any(Function));
    sharedGet.mockResolvedValue({
      data: { authenticated: true, accessToken: 'tok', tokenType: 'Bearer' },
    });

    jest.spyOn(apiClient, 'getValidToken').mockResolvedValue('tok');

    const out = await requestInterceptorFn({ headers: {} });
    expect(out.headers.Authorization).toBe('Bearer tok');
  });

  it('request interceptor omits Authorization when getValidToken is null (Backend-for-Frontend (BFF) session cookie)', async () => {
    expect(requestInterceptorFn).toEqual(expect.any(Function));
    jest.spyOn(apiClient, 'getValidToken').mockResolvedValue(null);
    const out = await requestInterceptorFn({ headers: {} });
    expect(out.headers.Authorization).toBeUndefined();
  });

  it('axios client is created with withCredentials for session cookies', () => {
    expect(axiosCreateOptions).toMatchObject({
      withCredentials: true,
      timeout: 10000,
    });
  });

  it('getValidToken returns null without calling oauth status endpoints', async () => {
    const token = await apiClient.getValidToken();
    expect(token).toBeNull();
    expect(sharedGet).not.toHaveBeenCalled();
  });

  it('401 response rejects with original error when refresh fails; does not call handleAuthFailure', async () => {
    expect(responseInterceptorFn).toEqual(expect.any(Function));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handleSpy = jest.spyOn(apiClient, 'handleAuthFailure').mockImplementation(() => {});
    jest.spyOn(apiClient, 'refreshToken').mockRejectedValue({ response: { status: 501 } });

    const originalErr = {
      response: { status: 401, data: { error: 'expired_token' } },
      config: { headers: {} },
    };

    await expect(responseInterceptorFn(originalErr)).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(handleSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('401 response rejects with original error when refresh returns 401', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const handleSpy = jest.spyOn(apiClient, 'handleAuthFailure').mockImplementation(() => {});
    jest.spyOn(apiClient, 'refreshToken').mockRejectedValue({ response: { status: 401 } });

    const originalErr = {
      response: { status: 401 },
      config: { headers: {} },
    };

    await expect(responseInterceptorFn(originalErr)).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(handleSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
