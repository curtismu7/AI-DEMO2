/**
 * Health check and system monitoring utilities
 */

import { Logger } from './Logger.js';
import { ErrorHandler, ErrorSeverity } from './ErrorHandler';

export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  CRITICAL = 'critical'
}

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  message?: string;
  lastChecked: Date;
  responseTime?: number;
  metadata?: Record<string, any>;
}

export interface SystemHealth {
  overall: HealthStatus;
  timestamp: Date;
  uptime: number;
  version: string;
  checks: HealthCheck[];
  metrics: SystemMetrics;
}

export interface SystemMetrics {
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  connections: {
    active: number;
    total: number;
  };
  sessions: {
    active: number;
    total: number;
  };
  errors: {
    last24h: number;
    lastHour: number;
    criticalLast24h: number;
  };
  performance: {
    avgResponseTime: number;
    requestsPerSecond: number;
  };
}

export interface HealthCheckConfig {
  name: string;
  checkFunction: () => Promise<HealthCheck>;
  interval: number; // milliseconds
  timeout: number; // milliseconds
  enabled: boolean;
}

/**
 * Health monitoring and system status tracking
 */
export class HealthMonitor {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private checks: Map<string, HealthCheckConfig> = new Map();
  private checkResults: Map<string, HealthCheck> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private startTime: Date;
  private static instance: HealthMonitor;

  // Metrics tracking
  private metrics: {
    activeConnections: number;
    totalConnections: number;
    activeSessions: number;
    totalSessions: number;
    requestCount: number;
    errorCount24h: number;
    errorCountHour: number;
    criticalErrorCount24h: number;
    responseTimes: number[];
  } = {
    activeConnections: 0,
    totalConnections: 0,
    activeSessions: 0,
    totalSessions: 0,
    requestCount: 0,
    errorCount24h: 0,
    errorCountHour: 0,
    criticalErrorCount24h: 0,
    responseTimes: []
  };

  constructor(logger: Logger, errorHandler: ErrorHandler) {
    this.logger = logger;
    this.errorHandler = errorHandler;
    this.startTime = new Date();
    this.setupDefaultHealthChecks();
  }

  static getInstance(logger?: Logger, errorHandler?: ErrorHandler): HealthMonitor {
    if (!HealthMonitor.instance) {
      if (!logger || !errorHandler) {
        throw new Error('Logger and ErrorHandler instances required for first initialization');
      }
      HealthMonitor.instance = new HealthMonitor(logger, errorHandler);
    }
    return HealthMonitor.instance;
  }

  /**
   * Setup default health checks
   */
  private setupDefaultHealthChecks(): void {
    // Memory usage check
    this.addHealthCheck({
      name: 'memory',
      checkFunction: this.checkMemoryUsage.bind(this),
      interval: 30000, // 30 seconds
      timeout: 5000,
      enabled: true
    });

    // System uptime check
    this.addHealthCheck({
      name: 'uptime',
      checkFunction: this.checkUptime.bind(this),
      interval: 60000, // 1 minute
      timeout: 1000,
      enabled: true
    });

    // Error rate check
    this.addHealthCheck({
      name: 'error_rate',
      checkFunction: this.checkErrorRate.bind(this),
      interval: 60000, // 1 minute
      timeout: 5000,
      enabled: true
    });
  }

  /**
   * Add a health check
   */
  addHealthCheck(config: HealthCheckConfig): void {
    this.checks.set(config.name, config);
    
    if (config.enabled) {
      this.startHealthCheck(config.name);
    }

    this.logger.debug(`Health check added: ${config.name}`, {
      operation: 'health_check_added',
      checkName: config.name,
      interval: config.interval
    });
  }

  /**
   * Remove a health check
   */
  removeHealthCheck(name: string): void {
    this.stopHealthCheck(name);
    this.checks.delete(name);
    this.checkResults.delete(name);

    this.logger.debug(`Health check removed: ${name}`, {
      operation: 'health_check_removed',
      checkName: name
    });
  }

  /**
   * Start a specific health check
   */
  private startHealthCheck(name: string): void {
    const config = this.checks.get(name);
    if (!config) return;

    // Stop existing interval if any
    this.stopHealthCheck(name);

    // Run initial check
    this.runHealthCheck(name);

    // Setup interval
    const interval = setInterval(() => {
      this.runHealthCheck(name);
    }, config.interval);

    this.intervals.set(name, interval);
  }

  /**
   * Stop a specific health check
   */
  private stopHealthCheck(name: string): void {
    const interval = this.intervals.get(name);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(name);
    }
  }

  /**
   * Run a specific health check
   */
  private async runHealthCheck(name: string): Promise<void> {
    const config = this.checks.get(name);
    if (!config) return;

    const startTime = Date.now();
    
    try {
      const timeoutPromise = new Promise<HealthCheck>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), config.timeout);
      });

      const checkPromise = config.checkFunction();
      const result = await Promise.race([checkPromise, timeoutPromise]);
      
      result.responseTime = Date.now() - startTime;
      this.checkResults.set(name, result);

      if (result.status === HealthStatus.UNHEALTHY || result.status === HealthStatus.CRITICAL) {
        await this.logger.warn(`Health check failed: ${name}`, {
          operation: 'health_check_failed',
          checkName: name,
          status: result.status,
          message: result.message,
          responseTime: result.responseTime
        });
      }

    } catch (error) {
      const failedCheck: HealthCheck = {
        name,
        status: HealthStatus.CRITICAL,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date(),
        responseTime: Date.now() - startTime
      };

      this.checkResults.set(name, failedCheck);

      await this.errorHandler.handleError(
        error instanceof Error ? error : new Error('Health check failed'),
        {
          operation: 'health_check',
          resourceId: name,
          resourceType: 'health_check'
        }
      );
    }
  }

  /**
   * Get current system health
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const checks = Array.from(this.checkResults.values());
    const overall = this.calculateOverallHealth(checks);
    const uptime = Date.now() - this.startTime.getTime();

    const systemHealth: SystemHealth = {
      overall,
      timestamp: new Date(),
      uptime,
      version: process.env.npm_package_version || '1.0.0',
      checks,
      metrics: this.calculateMetrics()
    };

    await this.logger.debug('System health requested', {
      operation: 'health_check',
      overall: overall,
      checksCount: checks.length
    });

    return systemHealth;
  }

  /**
   * Calculate overall health status
   */
  private calculateOverallHealth(checks: HealthCheck[]): HealthStatus {
    if (checks.length === 0) return HealthStatus.UNHEALTHY;

    const statusCounts = checks.reduce((acc, check) => {
      acc[check.status] = (acc[check.status] || 0) + 1;
      return acc;
    }, {} as Record<HealthStatus, number>);

    if (statusCounts[HealthStatus.CRITICAL] > 0) {
      return HealthStatus.CRITICAL;
    }

    if (statusCounts[HealthStatus.UNHEALTHY] > 0) {
      return HealthStatus.UNHEALTHY;
    }

    if (statusCounts[HealthStatus.DEGRADED] > 0) {
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.HEALTHY;
  }

  /**
   * Calculate system metrics
   */
  private calculateMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    const avgResponseTime = this.metrics.responseTimes.length > 0 
      ? this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length 
      : 0;

    return {
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      connections: {
        active: this.metrics.activeConnections,
        total: this.metrics.totalConnections
      },
      sessions: {
        active: this.metrics.activeSessions,
        total: this.metrics.totalSessions
      },
      errors: {
        last24h: this.metrics.errorCount24h,
        lastHour: this.metrics.errorCountHour,
        criticalLast24h: this.metrics.criticalErrorCount24h
      },
      performance: {
        avgResponseTime,
        requestsPerSecond: this.calculateRequestsPerSecond()
      }
    };
  }

  /**
   * Default health check implementations
   */
  private async checkMemoryUsage(): Promise<HealthCheck> {
    const memUsage = process.memoryUsage();
    const percentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status = HealthStatus.HEALTHY;
    let message = `Memory usage: ${percentage.toFixed(2)}%`;

    if (percentage > 90) {
      status = HealthStatus.CRITICAL;
      message += ' - Critical memory usage';
    } else if (percentage > 80) {
      status = HealthStatus.UNHEALTHY;
      message += ' - High memory usage';
    } else if (percentage > 70) {
      status = HealthStatus.DEGRADED;
      message += ' - Elevated memory usage';
    }

    return {
      name: 'memory',
      status,
      message,
      lastChecked: new Date(),
      metadata: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        percentage
      }
    };
  }

  private async checkUptime(): Promise<HealthCheck> {
    const uptime = Date.now() - this.startTime.getTime();
    const uptimeHours = uptime / (1000 * 60 * 60);

    return {
      name: 'uptime',
      status: HealthStatus.HEALTHY,
      message: `System uptime: ${uptimeHours.toFixed(2)} hours`,
      lastChecked: new Date(),
      metadata: {
        uptimeMs: uptime,
        uptimeHours
      }
    };
  }

  private async checkErrorRate(): Promise<HealthCheck> {
    const errorRate = this.metrics.errorCountHour;
    let status = HealthStatus.HEALTHY;
    let message = `Error rate: ${errorRate} errors/hour`;

    if (errorRate > 100) {
      status = HealthStatus.CRITICAL;
      message += ' - Critical error rate';
    } else if (errorRate > 50) {
      status = HealthStatus.UNHEALTHY;
      message += ' - High error rate';
    } else if (errorRate > 20) {
      status = HealthStatus.DEGRADED;
      message += ' - Elevated error rate';
    }

    return {
      name: 'error_rate',
      status,
      message,
      lastChecked: new Date(),
      metadata: {
        errorsLastHour: this.metrics.errorCountHour,
        errorsLast24h: this.metrics.errorCount24h,
        criticalErrorsLast24h: this.metrics.criticalErrorCount24h
      }
    };
  }

  /**
   * Metrics tracking methods
   */
  recordConnection(): void {
    this.metrics.activeConnections++;
    this.metrics.totalConnections++;
  }

  recordDisconnection(): void {
    this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);
  }

  recordSession(): void {
    this.metrics.activeSessions++;
    this.metrics.totalSessions++;
  }

  recordSessionEnd(): void {
    this.metrics.activeSessions = Math.max(0, this.metrics.activeSessions - 1);
  }

  recordRequest(responseTime: number): void {
    this.metrics.requestCount++;
    this.metrics.responseTimes.push(responseTime);
    
    // Keep only last 1000 response times for memory efficiency
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes = this.metrics.responseTimes.slice(-1000);
    }
  }

  recordError(severity: ErrorSeverity): void {
    this.metrics.errorCount24h++;
    this.metrics.errorCountHour++;
    
    if (severity === ErrorSeverity.CRITICAL) {
      this.metrics.criticalErrorCount24h++;
    }
  }

  private calculateRequestsPerSecond(): number {
    // Simple calculation based on uptime
    const uptimeSeconds = (Date.now() - this.startTime.getTime()) / 1000;
    return uptimeSeconds > 0 ? this.metrics.requestCount / uptimeSeconds : 0;
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    // Stop all health check intervals
    for (const [name] of this.intervals) {
      this.stopHealthCheck(name);
    }

    this.logger.info('Health monitor shutdown completed', {
      operation: 'health_monitor_shutdown'
    });
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      activeConnections: 0,
      totalConnections: 0,
      activeSessions: 0,
      totalSessions: 0,
      requestCount: 0,
      errorCount24h: 0,
      errorCountHour: 0,
      criticalErrorCount24h: 0,
      responseTimes: []
    };
  }
}