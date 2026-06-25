/**
 * CircuitBreaker Tests
 */

import { CircuitBreaker, CircuitBreakerState, CircuitBreakerError } from '../../src/utils/CircuitBreaker';

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000, // 1 second for testing
      monitoringPeriod: 500
    });
  });

  describe('initial state', () => {
    it('should start in CLOSED state', () => {
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should have zero failure count initially', () => {
      const stats = circuitBreaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.successCount).toBe(0);
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe('successful requests', () => {
    it('should execute successful requests normally', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should track successful requests', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      await circuitBreaker.execute(mockFn);
      await circuitBreaker.execute(mockFn);
      
      const stats = circuitBreaker.getStats();
      expect(stats.successCount).toBe(2);
      expect(stats.totalRequests).toBe(2);
    });
  });

  describe('failed requests', () => {
    it('should track failed requests', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      try {
        await circuitBreaker.execute(mockFn);
      } catch (error) {
        // Expected to fail
      }
      
      const stats = circuitBreaker.getStats();
      expect(stats.failureCount).toBe(1);
      expect(stats.totalRequests).toBe(1);
      expect(stats.lastFailureTime).toBeDefined();
    });

    it('should remain CLOSED until failure threshold is reached', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Fail 2 times (below threshold of 3)
      for (let i = 0; i < 2; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should open circuit breaker when failure threshold is reached', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Fail 3 times (reaching threshold)
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('OPEN state behavior', () => {
    beforeEach(async () => {
      // Open the circuit breaker
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
    });

    it('should reject requests immediately when OPEN', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      await expect(circuitBreaker.execute(mockFn))
        .rejects.toThrow(CircuitBreakerError);
      
      expect(mockFn).not.toHaveBeenCalled();
    });

    it('should transition to HALF_OPEN after reset timeout', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      await circuitBreaker.execute(mockFn);
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('HALF_OPEN state behavior', () => {
    beforeEach(async () => {
      // Open the circuit breaker
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
      
      // Wait for reset timeout to transition to HALF_OPEN
      await new Promise(resolve => setTimeout(resolve, 1100));
    });

    it('should close circuit breaker on successful request in HALF_OPEN', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.execute(mockFn);
      
      expect(result).toBe('success');
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
    });

    it('should reopen circuit breaker on failed request in HALF_OPEN', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      try {
        await circuitBreaker.execute(mockFn);
      } catch (error) {
        // Expected to fail
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
    });
  });

  describe('manual reset', () => {
    it('should reset circuit breaker manually', async () => {
      // Open the circuit breaker
      const mockFn = jest.fn().mockRejectedValue(new Error('test error'));
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(mockFn);
        } catch (error) {
          // Expected to fail
        }
      }
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.OPEN);
      
      // Manual reset
      circuitBreaker.manualReset();
      
      expect(circuitBreaker.getState()).toBe(CircuitBreakerState.CLOSED);
      
      const stats = circuitBreaker.getStats();
      expect(stats.failureCount).toBe(0);
      expect(stats.lastFailureTime).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should provide accurate statistics', async () => {
      const successFn = jest.fn().mockResolvedValue('success');
      const failFn = jest.fn().mockRejectedValue(new Error('test error'));
      
      // Execute some successful and failed requests
      await circuitBreaker.execute(successFn);
      await circuitBreaker.execute(successFn);
      
      try {
        await circuitBreaker.execute(failFn);
      } catch (error) {
        // Expected to fail
      }
      
      const stats = circuitBreaker.getStats();
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.totalRequests).toBe(3);
      expect(stats.state).toBe(CircuitBreakerState.CLOSED);
      expect(stats.lastFailureTime).toBeDefined();
    });
  });
});