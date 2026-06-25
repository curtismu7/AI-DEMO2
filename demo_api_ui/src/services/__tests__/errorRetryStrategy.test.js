import ErrorRetryStrategy from '../errorRetryStrategy';

describe('ErrorRetryStrategy', () => {
  describe('canRetry', () => {
    it('returns true for TRANSIENT errors', () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      expect(ErrorRetryStrategy.canRetry(error)).toBe(true);
    });

    it('returns false for USER errors', () => {
      const error = new Error('Token expired');
      error.classification = {
        category: 'USER',
        retryable: false,
      };

      expect(ErrorRetryStrategy.canRetry(error)).toBe(false);
    });

    it('returns false for CONFIG errors', () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        retryable: false,
        isConfig: true,
      };

      expect(ErrorRetryStrategy.canRetry(error)).toBe(false);
    });

    it('returns false for errors without classification', () => {
      const error = new Error('Unknown');
      expect(ErrorRetryStrategy.canRetry(error)).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    it('returns exponential backoff delays', () => {
      const delay0 = ErrorRetryStrategy.getRetryDelay(0);
      const delay1 = ErrorRetryStrategy.getRetryDelay(1);
      const delay2 = ErrorRetryStrategy.getRetryDelay(2);

      // Base delays: 500, 1000, 2000
      expect(delay0).toBeGreaterThanOrEqual(450); // 500 - 10%
      expect(delay0).toBeLessThanOrEqual(550); // 500 + 10%

      expect(delay1).toBeGreaterThanOrEqual(900); // 1000 - 10%
      expect(delay1).toBeLessThanOrEqual(1100); // 1000 + 10%

      expect(delay2).toBeGreaterThanOrEqual(1800); // 2000 - 10%
      expect(delay2).toBeLessThanOrEqual(2200); // 2000 + 10%
    });

    it('caps delay at MAX_DELAY_MS', () => {
      const largeAttempt = 10;
      const delay = ErrorRetryStrategy.getRetryDelay(largeAttempt);

      expect(delay).toBeLessThanOrEqual(ErrorRetryStrategy.MAX_DELAY_MS * 1.1);
    });
  });

  describe('executeWithRetry', () => {
    it('succeeds on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const onSuccess = jest.fn();

      const result = await ErrorRetryStrategy.executeWithRetry(fn, {
        onSuccess,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('success', 0);
    });

    it('retries on TRANSIENT error and succeeds', async () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      const fn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();
      const onSuccess = jest.fn();

      const result = await ErrorRetryStrategy.executeWithRetry(fn, {
        maxAttempts: 3,
        onRetry,
        onSuccess,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith('success', 1);
    });

    it('fails immediately on USER error', async () => {
      const error = new Error('Token expired');
      error.classification = {
        category: 'USER',
        retryable: false,
      };

      const fn = jest.fn().mockRejectedValue(error);
      const onFailure = jest.fn();

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, {
          maxAttempts: 3,
          onFailure,
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBe(error);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledWith(error, 1);
      }
    });

    it('fails immediately on CONFIG error', async () => {
      const error = new Error('JWKS unreachable');
      error.classification = {
        category: 'CONFIG',
        retryable: false,
        isConfig: true,
      };

      const fn = jest.fn().mockRejectedValue(error);

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, { maxAttempts: 3 });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBe(error);
        expect(fn).toHaveBeenCalledTimes(1);
      }
    });

    it('gives up after maxAttempts on TRANSIENT error', async () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      const fn = jest.fn().mockRejectedValue(error);
      const onRetry = jest.fn();

      try {
        await ErrorRetryStrategy.executeWithRetry(fn, {
          maxAttempts: 2,
          onRetry,
        });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBe(error);
        expect(fn).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledTimes(1); // Only 1 retry
      }
    });

    it('calls onRetry with correct parameters', async () => {
      const error = new Error('Network timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      const fn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const onRetry = jest.fn();

      await ErrorRetryStrategy.executeWithRetry(fn, {
        maxAttempts: 3,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      const [attempt, delay, err] = onRetry.mock.calls[0];
      expect(attempt).toBe(0); // First retry (0-indexed)
      expect(delay).toBeGreaterThan(0);
      expect(err).toBe(error);
    });
  });

  describe('retry', () => {
    it('succeeds on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('result');

      const result = await ErrorRetryStrategy.retry(fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on TRANSIENT error', async () => {
      const error = new Error('Timeout');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      const fn = jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce('success');

      const result = await ErrorRetryStrategy.retry(fn, 3);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('retryRequest', () => {
    it('retries a promise that fails', async () => {
      const error = new Error('Network error');
      error.classification = {
        category: 'TRANSIENT',
        retryable: true,
      };

      let attempts = 0;
      const requestFactory = () =>
        new Promise((resolve, reject) => {
          attempts++;
          if (attempts === 1) {
            reject(error);
          } else {
            resolve('success');
          }
        });

      const result = await ErrorRetryStrategy.retryRequest(requestFactory, {
        maxAttempts: 3,
      });

      expect(result).toBe('success');
    });
  });
});
