/**
 * Retry Manager with Exponential Backoff
 * Provides retry logic for transient failures
 */

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
}

export interface RetryStats {
  attempt: number;
  totalAttempts: number;
  lastError?: Error;
  totalDelay: number;
}

export class RetryError extends Error {
  constructor(
    message: string,
    public stats: RetryStats,
    public originalError: Error
  ) {
    super(message);
    this.name = 'RetryError';
  }
}

export class RetryManager {
  constructor(private config: RetryConfig) {}

  /**
   * Execute a function with retry logic
   */
  async execute<T>(
    fn: () => Promise<T>,
    shouldRetry: (error: Error) => boolean = this.defaultShouldRetry
  ): Promise<T> {
    let lastError: Error | undefined;
    let totalDelay = 0;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on the last attempt
        if (attempt > this.config.maxRetries) {
          break;
        }

        // Check if we should retry this error
        if (!shouldRetry(lastError)) {
          throw lastError;
        }

        // Calculate delay for next attempt
        const delay = this.calculateDelay(attempt);
        totalDelay += delay;

        console.log(
          `Retry attempt ${attempt}/${this.config.maxRetries} after ${delay}ms delay. Error: ${lastError.message}`
        );

        // Wait before next attempt
        await this.sleep(delay);
      }
    }

    // All retries exhausted - lastError should be defined at this point
    if (!lastError) {
      throw new Error('Unexpected error: no error recorded during retry attempts');
    }

    const stats: RetryStats = {
      attempt: this.config.maxRetries + 1,
      totalAttempts: this.config.maxRetries + 1,
      lastError,
      totalDelay
    };

    throw new RetryError(
      `All ${this.config.maxRetries} retry attempts failed. Last error: ${lastError.message}`,
      stats,
      lastError
    );
  }

  /**
   * Calculate delay for the given attempt with exponential backoff
   */
  private calculateDelay(attempt: number): number {
    // Calculate exponential backoff delay
    let delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt - 1);

    // Apply maximum delay limit
    delay = Math.min(delay, this.config.maxDelay);

    // Add jitter if enabled
    if (this.config.jitter) {
      // Add random jitter up to 10% of the delay
      const jitterAmount = delay * 0.1 * Math.random();
      delay += jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * Default retry condition - retry on network errors and 5xx status codes
   */
  private defaultShouldRetry(error: Error): boolean {
    // Check for network errors
    if (error.message.includes('ECONNREFUSED') || 
        error.message.includes('ENOTFOUND') ||
        error.message.includes('ETIMEDOUT') ||
        error.message.includes('Network Error')) {
      return true;
    }

    // Check for HTTP status codes that should be retried
    if ('statusCode' in error) {
      const statusCode = (error as any).statusCode;
      // Retry on 5xx server errors and 429 (rate limiting)
      return statusCode >= 500 || statusCode === 429;
    }

    return false;
  }

  /**
   * Sleep for the specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get retry configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }
}