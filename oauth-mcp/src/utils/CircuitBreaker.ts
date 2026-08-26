/**
 * Circuit Breaker Implementation
 * Provides fault tolerance for external service calls
 */

export enum CircuitBreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeout: number;
  monitoringPeriod: number;
  /**
   * Which thrown errors are evidence the UPSTREAM is sick.
   *
   * Defaults to "everything", which is what this breaker did unconditionally and
   * why a 403 "you can only check your own account balance" — an authorization
   * control working exactly as designed — could take banking down for every user
   * for a minute (TECH_DEBT 2026-08-26). A client error means the REQUEST was
   * wrong, not that the server is failing; counting it inverts the breaker's
   * purpose, and it is reachable on purpose by UC10's cross-owner attack sim.
   *
   * An error this returns false for is NEUTRAL: it neither trips the breaker nor
   * counts as a success. Deliberately not treated as success — the upstream did
   * answer, but a rejected request is thin evidence of health, and letting it
   * close a HALF_OPEN breaker would be a bigger behavioural claim than this fix
   * needs to make.
   */
  isFailure?: (error: unknown) => boolean;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  lastFailureTime?: Date;
  nextAttemptTime?: Date;
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitBreakerState = CircuitBreakerState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private totalRequests: number = 0;
  private lastFailureTime?: Date;
  private nextAttemptTime?: Date;

  constructor(private config: CircuitBreakerConfig) {}

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitBreakerState.OPEN) {
      if (this.shouldAttemptReset()) {
        this.state = CircuitBreakerState.HALF_OPEN;
      } else {
        throw new CircuitBreakerError(
          'Circuit breaker is OPEN - requests are being rejected',
          this.getStats()
        );
      }
    }

    this.totalRequests++;

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      // Only errors that indicate upstream sickness move the breaker. See
      // CircuitBreakerConfig.isFailure — the default keeps the original
      // count-everything behaviour, so no other consumer changes.
      if (this.countsAsFailure(error)) {
        this.onFailure();
      }
      throw error;
    }
  }

  /**
   * Handle successful request
   */
  private onSuccess(): void {
    this.successCount++;
    
    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Reset circuit breaker after successful request in half-open state
      this.reset();
    }
  }

  /** Does this error count as evidence the upstream is failing? */
  private countsAsFailure(error: unknown): boolean {
    if (typeof this.config.isFailure !== 'function') return true;
    try {
      return this.config.isFailure(error) !== false;
    } catch {
      // A throwing predicate must not swallow a real outage — fail safe by
      // counting the error, which is the pre-existing behaviour.
      return true;
    }
  }

  /**
   * Handle failed request
   */
  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.state === CircuitBreakerState.HALF_OPEN) {
      // Go back to open state if request fails in half-open state
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Open circuit breaker if failure threshold is reached
      this.state = CircuitBreakerState.OPEN;
      this.nextAttemptTime = new Date(Date.now() + this.config.resetTimeout);
    }
  }

  /**
   * Check if circuit breaker should attempt to reset
   */
  private shouldAttemptReset(): boolean {
    return this.nextAttemptTime ? new Date() >= this.nextAttemptTime : false;
  }

  /**
   * Reset circuit breaker to closed state
   */
  private reset(): void {
    this.state = CircuitBreakerState.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = undefined;
    this.nextAttemptTime = undefined;
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  manualReset(): void {
    this.reset();
  }

  /**
   * Get current state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }
}