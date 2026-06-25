/**
 * RetryManager Tests
 */

import { RetryManager, RetryError } from '../../src/utils/RetryManager';

describe('RetryManager', () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager({
      maxRetries: 3,
      baseDelay: 100, // Short delay for testing
      maxDelay: 1000,
      backoffMultiplier: 2,
      jitter: false // Disable jitter for predictable testing
    });
  });

  describe('successful execution', () => {
    it('should execute successful function without retries', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await retryManager.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry logic', () => {
    it('should retry on retryable errors', async () => {
      const mockFn = jest.fn()
        .mockRejectedValueOnce(new Error('Network Error'))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValue('success');
      
      const result = await retryManager.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Validation Error'));
      const shouldRetry = jest.fn().mockReturnValue(false);
      
      await expect(retryManager.execute(mockFn, shouldRetry))
        .rejects.toThrow('Validation Error');
      
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should exhaust all retries and throw RetryError', async () => {
      const persistentError = new Error('Network Error'); // Use retryable error
      const mockFn = jest.fn().mockRejectedValue(persistentError);
      
      await expect(retryManager.execute(mockFn))
        .rejects.toThrow(RetryError);
      
      expect(mockFn).toHaveBeenCalledTimes(4); // Initial + 3 retries
    });

    it('should include retry statistics in RetryError', async () => {
      const persistentError = new Error('Network Error'); // Use retryable error
      const mockFn = jest.fn().mockRejectedValue(persistentError);
      
      try {
        await retryManager.execute(mockFn);
      } catch (error) {
        expect(error).toBeInstanceOf(RetryError);
        const retryError = error as RetryError;
        expect(retryError.stats.totalAttempts).toBe(4);
        expect(retryError.stats.lastError).toBeDefined();
        expect(retryError.originalError.message).toBe('Network Error');
      }
    });
  });

  describe('exponential backoff', () => {
    it('should calculate correct delays with exponential backoff', () => {
      const retryManagerWithLongerDelays = new RetryManager({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: false
      });

      // Access private method for testing
      const calculateDelay = (retryManagerWithLongerDelays as any).calculateDelay.bind(retryManagerWithLongerDelays);
      
      expect(calculateDelay(1)).toBe(1000); // 1000 * 2^0
      expect(calculateDelay(2)).toBe(2000); // 1000 * 2^1
      expect(calculateDelay(3)).toBe(4000); // 1000 * 2^2
    });

    it('should respect maximum delay limit', () => {
      const retryManagerWithMaxDelay = new RetryManager({
        maxRetries: 5,
        baseDelay: 1000,
        maxDelay: 3000,
        backoffMultiplier: 2,
        jitter: false
      });

      const calculateDelay = (retryManagerWithMaxDelay as any).calculateDelay.bind(retryManagerWithMaxDelay);
      
      expect(calculateDelay(3)).toBe(3000); // Should be capped at maxDelay
      expect(calculateDelay(4)).toBe(3000); // Should be capped at maxDelay
    });

    it('should add jitter when enabled', () => {
      const retryManagerWithJitter = new RetryManager({
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        jitter: true
      });

      const calculateDelay = (retryManagerWithJitter as any).calculateDelay.bind(retryManagerWithJitter);
      
      const delay1 = calculateDelay(1);
      calculateDelay(1);
      
      // With jitter, delays should be different
      expect(delay1).toBeGreaterThanOrEqual(1000);
      expect(delay1).toBeLessThanOrEqual(1100); // Base + 10% jitter
    });
  });

  describe('default retry conditions', () => {
    it('should retry on network errors', async () => {
      const networkErrors = [
        new Error('ECONNREFUSED'),
        new Error('ENOTFOUND'),
        new Error('ETIMEDOUT'),
        new Error('Network Error')
      ];

      for (const error of networkErrors) {
        const mockFn = jest.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');
        
        const result = await retryManager.execute(mockFn);
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(2);
        
        mockFn.mockClear();
      }
    });

    it('should retry on 5xx status codes', async () => {
      const serverErrors = [
        { statusCode: 500, message: 'Internal Server Error' },
        { statusCode: 502, message: 'Bad Gateway' },
        { statusCode: 503, message: 'Service Unavailable' },
        { statusCode: 504, message: 'Gateway Timeout' }
      ];

      for (const errorData of serverErrors) {
        const error = new Error(errorData.message);
        (error as any).statusCode = errorData.statusCode;
        
        const mockFn = jest.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');
        
        const result = await retryManager.execute(mockFn);
        expect(result).toBe('success');
        expect(mockFn).toHaveBeenCalledTimes(2);
        
        mockFn.mockClear();
      }
    });

    it('should retry on 429 (rate limiting)', async () => {
      const rateLimitError = new Error('Too Many Requests');
      (rateLimitError as any).statusCode = 429;
      
      const mockFn = jest.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValue('success');
      
      const result = await retryManager.execute(mockFn);
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client errors (except 429)', async () => {
      const clientErrors = [
        { statusCode: 400, message: 'Bad Request' },
        { statusCode: 401, message: 'Unauthorized' },
        { statusCode: 403, message: 'Forbidden' },
        { statusCode: 404, message: 'Not Found' }
      ];

      for (const errorData of clientErrors) {
        const error = new Error(errorData.message);
        (error as any).statusCode = errorData.statusCode;
        
        const mockFn = jest.fn().mockRejectedValue(error);
        
        await expect(retryManager.execute(mockFn))
          .rejects.toThrow(errorData.message);
        
        expect(mockFn).toHaveBeenCalledTimes(1);
        
        mockFn.mockClear();
      }
    });
  });

  describe('configuration', () => {
    it('should return current configuration', () => {
      const config = retryManager.getConfig();
      
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelay).toBe(100);
      expect(config.maxDelay).toBe(1000);
      expect(config.backoffMultiplier).toBe(2);
      expect(config.jitter).toBe(false);
    });
  });
});