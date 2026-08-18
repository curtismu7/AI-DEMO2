import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import ExecutionEngine from '../executionEngine';

vi.mock('axios');

describe('ExecutionEngine', () => {
  let engine;
  let mockFlowSpec;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Setup mock flow spec
    mockFlowSpec = {
      steps: [
        {
          id: 'step-1',
          method: 'GET',
          endpoint: '/api/flow/status',
          headers: { 'X-Custom': 'value' }
        },
        {
          id: 'step-2',
          method: 'POST',
          endpoint: '/api/flow/execute',
          body: { action: 'process' },
          headers: {}
        }
      ],
      stopOnError: false
    };

    engine = new ExecutionEngine(mockFlowSpec, 'https://api.test.com:3001');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('initializes with flow spec and custom BFF URL', () => {
      const engine = new ExecutionEngine(mockFlowSpec, 'https://custom.url:3001');
      expect(engine.flowSpec).toEqual(mockFlowSpec);
      expect(engine.bffBaseUrl).toBe('https://custom.url:3001');
    });

    it('defaults to the page origin so the session cookie is sent', () => {
      const engine = new ExecutionEngine(mockFlowSpec);
      // resolveApiBaseUrl() returns '' (same origin) when REACT_APP_API_URL is
      // unset or points at the host the page is already served from
      expect(engine.bffBaseUrl).toBe('');
    });

    it('initializes state correctly', () => {
      expect(engine.state).toEqual({
        currentStep: null,
        results: [],
        error: null,
        context: {}
      });
    });
  });

  describe('executeStep', () => {
    it('executes a GET request successfully', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        data: { success: true }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const result = await engine.executeStep('step-1');

      expect(result.stepId).toBe('step-1');
      expect(result.response.status).toBe(200);
      expect(result.response.body).toEqual({ success: true });
      expect(result.request.method).toBe('GET');
      expect(result.request.url).toBe('/api/flow/status');
    });

    it('executes a POST request with body', async () => {
      const mockResponse = {
        status: 201,
        statusText: 'Created',
        headers: { 'content-type': 'application/json' },
        data: { id: '123', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' } // gitleaks:allow
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const result = await engine.executeStep('step-2');

      expect(result.stepId).toBe('step-2');
      expect(result.response.status).toBe(201);
      expect(result.request.method).toBe('POST');
      expect(result.request.body).toEqual({ action: 'process' });
      expect(result.decodedToken).toBeDefined();
      expect(result.decodedToken.isValid).toBe(true);
    });

    it('captures authorization header token', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' // gitleaks:allow
        },
        data: { success: true }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const result = await engine.executeStep('step-1');

      expect(result.decodedToken).toBeDefined();
      expect(result.decodedToken.isValid).toBe(true);
      expect(result.decodedToken.payload.sub).toBe('1234567890');
    });

    it('updates current step in state', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      expect(engine.state.currentStep).toBeNull();

      await engine.executeStep('step-1');

      expect(engine.state.currentStep).toBe('step-1');
    });

    it('appends result to results array', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { test: 'data' }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      expect(engine.state.results).toHaveLength(0);

      await engine.executeStep('step-1');

      expect(engine.state.results).toHaveLength(1);
      expect(engine.state.results[0].stepId).toBe('step-1');
    });

    it('throws error if step not found', async () => {
      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      await expect(engine.executeStep('non-existent')).rejects.toThrow('Step non-existent not found');
    });

    it('captures error in state when step fails', async () => {
      const error = new Error('Network error');

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockRejectedValue(error),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      await expect(engine.executeStep('step-1')).rejects.toThrow('Network error');

      expect(engine.state.error).toBeDefined();
      expect(engine.state.error.message).toBe('Network error');
      expect(engine.state.error.stepId).toBe('step-1');
    });

    it('handles 4xx/5xx responses gracefully', async () => {
      const errorResponse = {
        status: 404,
        statusText: 'Not Found',
        headers: {},
        data: { error: 'Not found' }
      };

      const mockError = new Error('Request failed');
      mockError.response = errorResponse;

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      // ExecutionEngine captures error responses and returns them rather than throwing
      const result = await engine.executeStep('step-1');

      expect(result.response.status).toBe(404);
      expect(result.response.body).toEqual({ error: 'Not found' });
    });

    it('supports custom headers in request', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const result = await engine.executeStep('step-1');

      expect(result.request.headers['X-Custom']).toBe('value');
    });

    it('supports auth token in request', async () => {
      const flowWithAuth = {
        steps: [
          {
            id: 'auth-step',
            method: 'POST',
            endpoint: '/api/secure',
            authToken: 'my-auth-token',
            body: {}
          }
        ]
      };

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(flowWithAuth);

      const result = await engine.executeStep('auth-step');

      expect(result.request.headers.Authorization).toBe('Bearer my-auth-token');
    });
  });

  describe('executeAll', () => {
    it('executes all steps sequentially', async () => {
      const mockResponse1 = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { step: 1 }
      };

      const mockResponse2 = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { step: 2 }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse1),
        post: vi.fn().mockResolvedValue(mockResponse2),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const results = await engine.executeAll();

      expect(results).toHaveLength(2);
      expect(results[0].stepId).toBe('step-1');
      expect(results[1].stepId).toBe('step-2');
    });

    it('calls onProgress with accumulated state after each step', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const onProgress = vi.fn();
      await engine.executeAll(onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress.mock.calls[0][0].results).toHaveLength(1);
      expect(onProgress.mock.calls[1][0].results).toHaveLength(2);
    });

    it('stops on error if stopOnError is true', async () => {
      const flowWithStopOnError = {
        steps: [
          {
            id: 'step-1',
            method: 'GET',
            endpoint: '/api/flow/status'
          },
          {
            id: 'step-2',
            method: 'POST',
            endpoint: '/api/flow/execute',
            body: {}
          }
        ],
        stopOnError: true
      };

      const mockError = new Error('Step failed');

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(flowWithStopOnError);

      await expect(engine.executeAll()).rejects.toThrow('Step failed');
    });

    it('continues on error if stopOnError is false', async () => {
      const mockResponse2 = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      const mockError = new Error('Step 1 failed');

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError),
        post: vi.fn().mockResolvedValue(mockResponse2),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const results = await engine.executeAll();

      expect(results).toHaveLength(2);
      expect(results[0].error).toBe('Step 1 failed');
      expect(results[1].stepId).toBe('step-2');
    });

    it('throws error if flow spec has no steps', async () => {
      const invalidFlow = { steps: [] };

      engine = new ExecutionEngine(invalidFlow);

      await expect(engine.executeAll()).rejects.toThrow('Invalid flow spec');
    });

    it('throws error if flow spec is null', async () => {
      engine = new ExecutionEngine(null);

      await expect(engine.executeAll()).rejects.toThrow('Invalid flow spec');
    });
  });

  describe('reset', () => {
    it('clears state', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      // Execute a step
      await engine.executeStep('step-1');
      expect(engine.state.results).toHaveLength(1);

      // Reset
      engine.reset();

      expect(engine.state).toEqual({
        currentStep: null,
        results: [],
        error: null,
        context: {}
      });
    });

    it('resets error state', async () => {
      const mockError = new Error('Test error');

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockRejectedValue(mockError),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      // Try to execute (will fail)
      try {
        await engine.executeStep('step-1');
      } catch (_) {
        // Expected
      }

      expect(engine.state.error).toBeDefined();

      // Reset
      engine.reset();

      expect(engine.state.error).toBeNull();
    });
  });

  describe('body interpolation', () => {
    // dpop step 2 and the introspect step need a value produced by step 1 in the
    // request BODY, not the URL — chaining flows depend on this.
    const chainedFlow = {
      steps: [
        {
          id: 'issue',
          method: 'POST',
          endpoint: '/api/auth/oauth/token',
          body: { grant_type: 'token-exchange' },
          responseMap: { accessToken: 'access_token' }
        },
        {
          id: 'verify',
          method: 'POST',
          endpoint: '/api/auth/gateway/verify-dpop',
          body: { access_token: ':accessToken', note: 'token :accessToken bound', nested: { list: [':accessToken'] } }
        },
        {
          id: 'unknown-placeholder',
          method: 'POST',
          endpoint: '/api/auth/gateway/verify-dpop',
          body: { access_token: ':neverSet' }
        }
      ],
      stopOnError: false
    };

    function mockPost(post) {
      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post,
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });
    }

    it('substitutes a mapped response value into the next request body', async () => {
      const post = vi.fn()
        .mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, data: { access_token: 'tok-abc' } })
        .mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, data: { valid: true } });
      mockPost(post);

      const chained = new ExecutionEngine(chainedFlow);
      await chained.executeStep('issue');
      await chained.executeStep('verify');

      expect(post.mock.calls[1][1]).toEqual({
        access_token: 'tok-abc',
        note: 'token tok-abc bound',
        nested: { list: ['tok-abc'] }
      });
    });

    it('leaves the placeholder untouched when the context has no value', async () => {
      const post = vi.fn().mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, data: {} });
      mockPost(post);

      const chained = new ExecutionEngine(chainedFlow);
      await chained.executeStep('unknown-placeholder');

      expect(post.mock.calls[0][1]).toEqual({ access_token: ':neverSet' });
    });

    it('does not mutate the flow spec body', async () => {
      const post = vi.fn()
        .mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, data: { access_token: 'tok-abc' } })
        .mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, data: {} });
      mockPost(post);

      const chained = new ExecutionEngine(chainedFlow);
      await chained.executeStep('issue');
      await chained.executeStep('verify');

      expect(chainedFlow.steps[1].body.access_token).toBe(':accessToken');
    });
  });

  describe('getState', () => {
    it('returns a copy of state', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      await engine.executeStep('step-1');

      const state = engine.getState();

      expect(state.results).toHaveLength(1);
      expect(state.currentStep).toBe('step-1');

      // Verify it's a deep copy
      state.results[0].stepId = 'modified';
      expect(engine.state.results[0].stepId).toBe('step-1');
    });
  });

  describe('getResult', () => {
    it('returns a specific result by step ID', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { test: 'data' }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn().mockResolvedValue(mockResponse),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      await engine.executeStep('step-1');
      await engine.executeStep('step-2');

      const result = engine.getResult('step-2');

      expect(result).toBeDefined();
      expect(result.stepId).toBe('step-2');
      expect(result.response.body).toEqual({ test: 'data' });
    });

    it('returns null if result not found', async () => {
      engine = new ExecutionEngine(mockFlowSpec);

      const result = engine.getResult('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('HTTP methods', () => {
    it('supports DELETE method', async () => {
      const flowWithDelete = {
        steps: [
          {
            id: 'delete-step',
            method: 'DELETE',
            endpoint: '/api/resource/123'
          }
        ]
      };

      const mockResponse = {
        status: 204,
        statusText: 'No Content',
        headers: {},
        data: null
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn().mockResolvedValue(mockResponse)
      });

      engine = new ExecutionEngine(flowWithDelete);

      const result = await engine.executeStep('delete-step');

      expect(result.request.method).toBe('DELETE');
      expect(result.response.status).toBe(204);
    });

    it('supports PUT method', async () => {
      const flowWithPut = {
        steps: [
          {
            id: 'put-step',
            method: 'PUT',
            endpoint: '/api/resource/123',
            body: { name: 'updated' }
          }
        ]
      };

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { id: '123', name: 'updated' }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn().mockResolvedValue(mockResponse),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(flowWithPut);

      const result = await engine.executeStep('put-step');

      expect(result.request.method).toBe('PUT');
      expect(result.request.body).toEqual({ name: 'updated' });
    });

    it('supports PATCH method', async () => {
      const flowWithPatch = {
        steps: [
          {
            id: 'patch-step',
            method: 'PATCH',
            endpoint: '/api/resource/123',
            body: { status: 'active' }
          }
        ]
      };

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { id: '123', status: 'active' }
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn().mockResolvedValue(mockResponse),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(flowWithPatch);

      const result = await engine.executeStep('patch-step');

      expect(result.request.method).toBe('PATCH');
      expect(result.request.body).toEqual({ status: 'active' });
    });
  });

  describe('timestamp tracking', () => {
    it('records timestamp for each result', async () => {
      const mockResponse = {
        status: 200,
        statusText: 'OK',
        headers: {},
        data: {}
      };

      vi.spyOn(axios, 'create').mockReturnValue({
        get: vi.fn().mockResolvedValue(mockResponse),
        post: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn()
      });

      engine = new ExecutionEngine(mockFlowSpec);

      const before = new Date();
      await engine.executeStep('step-1');
      const after = new Date();

      const result = engine.getResult('step-1');

      expect(result.timestamp).toBeDefined();
      const resultTime = new Date(result.timestamp);
      expect(resultTime.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(resultTime.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });
});
