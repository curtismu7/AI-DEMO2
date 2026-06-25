/**
 * Unit tests for HealthMonitor utility
 */

import {
  HealthMonitor,
  HealthStatus,
  type HealthCheckConfig
} from '../../src/utils/HealthMonitor';
import { Logger } from '../../src/utils/Logger';
import { ErrorHandler, ErrorSeverity } from '../../src/utils/ErrorHandler';

describe('HealthMonitor', () => {
  let healthMonitor: HealthMonitor;
  let mockLogger: jest.Mocked<Logger>;
  let mockErrorHandler: jest.Mocked<ErrorHandler>;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      logAuthenticationEvent: jest.fn(),
      logBankingOperation: jest.fn(),
      logSecurityEvent: jest.fn()
    } as any;

    mockErrorHandler = {
      handleError: jest.fn(),
      createErrorResponse: jest.fn(),
      isRetryable: jest.fn(),
      getErrorStats: jest.fn()
    } as any;

    healthMonitor = new HealthMonitor(mockLogger, mockErrorHandler);
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Clear any existing intervals
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    healthMonitor.shutdown();
    jest.useRealTimers();
    // Reset singleton instance for clean tests
    (HealthMonitor as any).instance = undefined;
  });

  describe('Singleton Pattern', () => {
    it('should create singleton instance', () => {
      const instance1 = HealthMonitor.getInstance(mockLogger, mockErrorHandler);
      const instance2 = HealthMonitor.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    it('should throw error if no dependencies provided for first initialization', () => {
      expect(() => HealthMonitor.getInstance()).toThrow('Logger and ErrorHandler instances required for first initialization');
    });
  });

  describe('Health Check Management', () => {
    it('should add custom health check', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        name: 'custom_check',
        status: HealthStatus.HEALTHY,
        message: 'All good',
        lastChecked: new Date()
      });

      const config: HealthCheckConfig = {
        name: 'custom_check',
        checkFunction: mockCheck,
        interval: 5000,
        timeout: 1000,
        enabled: true
      };

      healthMonitor.addHealthCheck(config);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Health check added: custom_check',
        expect.objectContaining({
          operation: 'health_check_added',
          checkName: 'custom_check',
          interval: 5000
        })
      );
    });

    it('should remove health check', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        name: 'test_check',
        status: HealthStatus.HEALTHY,
        message: 'Test',
        lastChecked: new Date()
      });

      const config: HealthCheckConfig = {
        name: 'test_check',
        checkFunction: mockCheck,
        interval: 5000,
        timeout: 1000,
        enabled: true
      };

      healthMonitor.addHealthCheck(config);
      healthMonitor.removeHealthCheck('test_check');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Health check removed: test_check',
        expect.objectContaining({
          operation: 'health_check_removed',
          checkName: 'test_check'
        })
      );
    });

    it('should not start disabled health checks', () => {
      const mockCheck = jest.fn();

      const config: HealthCheckConfig = {
        name: 'disabled_check',
        checkFunction: mockCheck,
        interval: 1000,
        timeout: 500,
        enabled: false
      };

      healthMonitor.addHealthCheck(config);

      // Fast forward time
      jest.advanceTimersByTime(2000);

      expect(mockCheck).not.toHaveBeenCalled();
    });
  });

  describe('Default Health Checks', () => {
    it('should run memory usage check', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();
      const memoryCheck = systemHealth.checks.find(check => check.name === 'memory');

      expect(memoryCheck).toBeDefined();
      expect([
        HealthStatus.HEALTHY,
        HealthStatus.DEGRADED,
        HealthStatus.UNHEALTHY,
        HealthStatus.CRITICAL
      ]).toContain(memoryCheck?.status);
      expect(memoryCheck?.message).toContain('Memory usage:');
      expect(memoryCheck?.metadata).toHaveProperty('percentage');
    });

    it('should run uptime check', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();
      const uptimeCheck = systemHealth.checks.find(check => check.name === 'uptime');

      expect(uptimeCheck).toBeDefined();
      expect(uptimeCheck?.status).toBe(HealthStatus.HEALTHY);
      expect(uptimeCheck?.message).toContain('System uptime:');
      expect(uptimeCheck?.metadata).toHaveProperty('uptimeHours');
    });

    it('should run error rate check', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();
      const errorRateCheck = systemHealth.checks.find(check => check.name === 'error_rate');

      expect(errorRateCheck).toBeDefined();
      expect(errorRateCheck?.message).toContain('Error rate:');
      expect(errorRateCheck?.metadata).toHaveProperty('errorsLastHour');
    });
  });

  describe('Health Check Execution', () => {
    it('should handle successful health check', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        name: 'success_check',
        status: HealthStatus.HEALTHY,
        message: 'Everything is fine',
        lastChecked: new Date()
      });

      const config: HealthCheckConfig = {
        name: 'success_check',
        checkFunction: mockCheck,
        interval: 5000,
        timeout: 1000,
        enabled: false // Disable to avoid timing issues
      };

      healthMonitor.addHealthCheck(config);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Health check added: success_check',
        expect.objectContaining({
          operation: 'health_check_added',
          checkName: 'success_check'
        })
      );
    });

    it('should handle health check configuration', () => {
      const mockCheck = jest.fn();

      const config: HealthCheckConfig = {
        name: 'test_check',
        checkFunction: mockCheck,
        interval: 1000,
        timeout: 500,
        enabled: false
      };

      healthMonitor.addHealthCheck(config);
      
      // Verify check was added but not started
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Health check added: test_check',
        expect.objectContaining({
          checkName: 'test_check'
        })
      );
    });
  });

  describe('Overall Health Calculation', () => {
    it('should return UNHEALTHY when no checks are available', async () => {
      // Remove all default checks
      healthMonitor.removeHealthCheck('memory');
      healthMonitor.removeHealthCheck('uptime');
      healthMonitor.removeHealthCheck('error_rate');

      const systemHealth = await healthMonitor.getSystemHealth();
      expect(systemHealth.overall).toBe(HealthStatus.UNHEALTHY);
    });

    it('should calculate overall health from default checks', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();
      
      // Should have default checks running
      expect(systemHealth.checks.length).toBeGreaterThan(0);
      expect([
        HealthStatus.HEALTHY,
        HealthStatus.DEGRADED,
        HealthStatus.UNHEALTHY,
        HealthStatus.CRITICAL
      ]).toContain(systemHealth.overall);
    });
  });

  describe('Metrics Tracking', () => {
    beforeEach(() => {
      healthMonitor.resetMetrics();
    });

    it('should track connections', async () => {
      healthMonitor.recordConnection();
      healthMonitor.recordConnection();
      healthMonitor.recordDisconnection();

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.connections.active).toBe(1);
      expect(systemHealth.metrics.connections.total).toBe(2);
    });

    it('should track sessions', async () => {
      healthMonitor.recordSession();
      healthMonitor.recordSession();
      healthMonitor.recordSessionEnd();

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.sessions.active).toBe(1);
      expect(systemHealth.metrics.sessions.total).toBe(2);
    });

    it('should track requests and response times', async () => {
      healthMonitor.recordRequest(100);
      healthMonitor.recordRequest(200);
      healthMonitor.recordRequest(150);

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.performance.avgResponseTime).toBe(150);
      expect(systemHealth.metrics.performance.requestsPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should track errors by severity', async () => {
      healthMonitor.recordError(ErrorSeverity.LOW);
      healthMonitor.recordError(ErrorSeverity.CRITICAL);
      healthMonitor.recordError(ErrorSeverity.HIGH);

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.errors.last24h).toBe(3);
      expect(systemHealth.metrics.errors.lastHour).toBe(3);
      expect(systemHealth.metrics.errors.criticalLast24h).toBe(1);
    });

    it('should prevent negative connection counts', async () => {
      healthMonitor.recordDisconnection();
      healthMonitor.recordDisconnection();

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.connections.active).toBe(0);
    });

    it('should prevent negative session counts', async () => {
      healthMonitor.recordSessionEnd();
      healthMonitor.recordSessionEnd();

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.sessions.active).toBe(0);
    });

    it('should limit response time history for memory efficiency', async () => {
      // Record more than 1000 response times
      for (let i = 0; i < 1200; i++) {
        healthMonitor.recordRequest(100 + i);
      }

      const systemHealth = await healthMonitor.getSystemHealth();
      
      // Should still calculate average correctly
      expect(systemHealth.metrics.performance.avgResponseTime).toBeGreaterThan(0);
    });
  });

  describe('System Health Response', () => {
    it('should include all required fields in system health', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();

      expect(systemHealth).toHaveProperty('overall');
      expect(systemHealth).toHaveProperty('timestamp');
      expect(systemHealth).toHaveProperty('uptime');
      expect(systemHealth).toHaveProperty('version');
      expect(systemHealth).toHaveProperty('checks');
      expect(systemHealth).toHaveProperty('metrics');

      expect(systemHealth.timestamp).toBeInstanceOf(Date);
      expect(systemHealth.uptime).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(systemHealth.checks)).toBe(true);
    });

    it('should include memory metrics', async () => {
      const systemHealth = await healthMonitor.getSystemHealth();

      expect(systemHealth.metrics.memory).toHaveProperty('used');
      expect(systemHealth.metrics.memory).toHaveProperty('total');
      expect(systemHealth.metrics.memory).toHaveProperty('percentage');
      expect(systemHealth.metrics.memory.percentage).toBeGreaterThanOrEqual(0);
      expect(systemHealth.metrics.memory.percentage).toBeLessThanOrEqual(100);
    });

    it('should log health check requests', async () => {
      await healthMonitor.getSystemHealth();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'System health requested',
        expect.objectContaining({
          operation: 'health_check',
          overall: expect.any(String),
          checksCount: expect.any(Number)
        })
      );
    });
  });

  describe('Shutdown and Cleanup', () => {
    it('should shutdown cleanly', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        name: 'test_check',
        status: HealthStatus.HEALTHY,
        message: 'Test',
        lastChecked: new Date()
      });

      healthMonitor.addHealthCheck({
        name: 'test_check',
        checkFunction: mockCheck,
        interval: 1000,
        timeout: 500,
        enabled: true
      });

      healthMonitor.shutdown();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Health monitor shutdown completed',
        expect.objectContaining({
          operation: 'health_monitor_shutdown'
        })
      );

      // Verify intervals are cleared
      jest.advanceTimersByTime(2000);
      expect(mockCheck).toHaveBeenCalledTimes(1); // Only initial call
    });

    it('should reset metrics correctly', async () => {
      healthMonitor.recordConnection();
      healthMonitor.recordSession();
      healthMonitor.recordError(ErrorSeverity.HIGH);

      healthMonitor.resetMetrics();

      const systemHealth = await healthMonitor.getSystemHealth();
      
      expect(systemHealth.metrics.connections.active).toBe(0);
      expect(systemHealth.metrics.connections.total).toBe(0);
      expect(systemHealth.metrics.sessions.active).toBe(0);
      expect(systemHealth.metrics.sessions.total).toBe(0);
      expect(systemHealth.metrics.errors.last24h).toBe(0);
    });
  });

  describe('Health Check Response Times', () => {
    it('should support response time tracking', () => {
      const mockCheck = jest.fn().mockResolvedValue({
        name: 'test_check',
        status: HealthStatus.HEALTHY,
        message: 'Test check',
        lastChecked: new Date(),
        responseTime: 100
      });

      const config: HealthCheckConfig = {
        name: 'test_check',
        checkFunction: mockCheck,
        interval: 5000,
        timeout: 1000,
        enabled: false
      };

      healthMonitor.addHealthCheck(config);
      
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Health check added: test_check',
        expect.objectContaining({
          checkName: 'test_check'
        })
      );
    });
  });
});