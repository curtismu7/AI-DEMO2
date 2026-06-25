/**
 * apiErrorHandler.test.js
 * Unit tests for error classification and retry logic
 */

import {
  classifyApiError,
  getExponentialBackoffDelay,
  getColdStartRetryDelays,
  executeWithRetry,
} from "../apiErrorHandler";

describe("apiErrorHandler", () => {
  describe("classifyApiError", () => {
    it("should classify null as unknown error", () => {
      const result = classifyApiError(null);
      expect(result.type).toBe("unknown");
      expect(result.isRetryable).toBe(false);
    });

    it("should classify network timeout as retryable", () => {
      const err = new Error("Request timed out");
      const result = classifyApiError(err);
      expect(result.type).toBe("network");
      expect(result.isRetryable).toBe(true);
      expect(result.code).toBe("E_NETWORK");
    });

    it("should classify ECONNREFUSED as network error", () => {
      const err = new Error("ECONNREFUSED: Connection refused");
      const result = classifyApiError(err);
      expect(result.type).toBe("network");
      expect(result.isRetryable).toBe(true);
    });

    it("should classify Failed to fetch as network error", () => {
      const err = new Error("Failed to fetch");
      const result = classifyApiError(err);
      expect(result.type).toBe("network");
      expect(result.isRetryable).toBe(true);
    });

    it("should classify 401 as auth error (retryable)", () => {
      const err = new Error("Unauthorized");
      err.status = 401;
      const result = classifyApiError(err);
      expect(result.type).toBe("auth");
      expect(result.isRetryable).toBe(true);
      expect(result.statusCode).toBe(401);
    });

    it("should classify 403 as auth error (retryable)", () => {
      const err = new Error("Forbidden");
      err.status = 403;
      const result = classifyApiError(err);
      expect(result.type).toBe("auth");
      expect(result.isRetryable).toBe(true);
    });

    it("should classify 429 as rate limit (retryable)", () => {
      const err = new Error("Too Many Requests");
      err.status = 429;
      const result = classifyApiError(err);
      expect(result.type).toBe("rateLimit");
      expect(result.isRetryable).toBe(true);
      expect(result.code).toBe("E_RATE_LIMIT");
    });

    it("should classify 500 as server error (retryable)", () => {
      const err = new Error("Internal Server Error");
      err.status = 500;
      const result = classifyApiError(err);
      expect(result.type).toBe("server");
      expect(result.isRetryable).toBe(true);
      expect(result.code).toBe("E_SERVER_500");
    });

    it("should classify 502 as server error (retryable)", () => {
      const err = new Error("Bad Gateway");
      err.status = 502;
      const result = classifyApiError(err);
      expect(result.type).toBe("server");
      expect(result.isRetryable).toBe(true);
    });

    it("should classify 400 as client error (not retryable)", () => {
      const err = new Error("Bad Request");
      err.status = 400;
      const result = classifyApiError(err);
      expect(result.type).toBe("client");
      expect(result.isRetryable).toBe(false);
    });

    it("should classify 404 as client error (not retryable)", () => {
      const err = new Error("Not Found");
      err.status = 404;
      const result = classifyApiError(err);
      expect(result.type).toBe("client");
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("getExponentialBackoffDelay", () => {
    it("should return 0 for negative attempt", () => {
      const delay = getExponentialBackoffDelay(-1);
      expect(delay).toBe(0);
    });

    it("should return 0ms for first attempt (2^0 = 1)", () => {
      const delay = getExponentialBackoffDelay(0);
      expect(delay).toBeGreaterThanOrEqual(190); // 200 * 1 with ±5% jitter
      expect(delay).toBeLessThanOrEqual(220);
    });

    it("should double delay for each attempt", () => {
      const delay0 = getExponentialBackoffDelay(0, 100, 50000);
      const delay1 = getExponentialBackoffDelay(1, 100, 50000);
      const delay2 = getExponentialBackoffDelay(2, 100, 50000);

      // With jitter, they should trend correctly
      expect(delay1).toBeGreaterThan(delay0 * 1.5); // Roughly 2x with jitter
      expect(delay2).toBeGreaterThan(delay1 * 1.5);
    });

    it("should respect max delay cap", () => {
      const delay = getExponentialBackoffDelay(10, 200, 1000);
      expect(delay).toBeLessThanOrEqual(1000);
    });

    it("should apply jitter (±5%)", () => {
      // Run multiple times — some should be above/below base * 2^attempt
      const delays = Array.from({ length: 10 }, (_, i) =>
        getExponentialBackoffDelay(1, 200, 50000),
      );

      // Should have some variation due to jitter
      const unique = new Set(delays);
      expect(unique.size).toBeGreaterThan(1);
    });

    it("should use custom base and max delays", () => {
      const delay = getExponentialBackoffDelay(0, 500, 5000);
      // jitter is Math.random() * 0.1 multiplicative: delay = 500 * (1 + [0..0.1]) = [500, 550]
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThanOrEqual(550);
    });
  });

  describe("getColdStartRetryDelays", () => {
    it("should return cold-start retry delays", () => {
      const delays = getColdStartRetryDelays();
      expect(delays).toEqual([0, 600, 1400, 2500]);
    });

    it("should return array with 4 elements", () => {
      const delays = getColdStartRetryDelays();
      expect(delays.length).toBe(4);
    });

    it("should have increasing delays", () => {
      const delays = getColdStartRetryDelays();
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThan(delays[i - 1]);
      }
    });
  });

  describe("executeWithRetry", () => {
    it("should succeed on first attempt", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: "test" }),
      });

      const response = await executeWithRetry(mockFetch, { maxRetries: 3 });
      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should retry on network failure then succeed", async () => {
      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(new Error("Failed to fetch"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: "test" }),
        });

      const response = await executeWithRetry(mockFetch, { maxRetries: 3 });
      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should throw after max retries exceeded", async () => {
      const mockFetch = jest
        .fn()
        .mockRejectedValue(new Error("Failed to fetch"));

      await expect(
        executeWithRetry(mockFetch, { maxRetries: 2 }),
      ).rejects.toThrow();

      // 1 initial + 2 retries = 3 total calls
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should not retry on 400 client error", async () => {
      const err = new Error("Bad Request");
      err.status = 400;

      const mockFetch = jest.fn().mockRejectedValue(err);

      await expect(
        executeWithRetry(mockFetch, { maxRetries: 3 }),
      ).rejects.toThrow();

      // Should not retry — client error is not retryable
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should retry on 500 server error", async () => {
      const err = new Error("Server Error");
      err.status = 500;

      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: "test" }),
        });

      const response = await executeWithRetry(mockFetch, { maxRetries: 3 });
      expect(response.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should call onRetry callback", async () => {
      const onRetry = jest.fn();
      const err = new Error("Failed to fetch");

      const mockFetch = jest
        .fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: "test" }),
        });

      await executeWithRetry(mockFetch, { maxRetries: 3, onRetry });
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        0,
        expect.any(Number),
        expect.objectContaining({ type: "network", isRetryable: true }),
      );
    });

    it("should attach classification to error", async () => {
      const err = new Error("Server Error");
      err.status = 500;

      const mockFetch = jest.fn().mockRejectedValue(err);

      let thrownError;
      try {
        await executeWithRetry(mockFetch, { maxRetries: 0 });
      } catch (e) {
        thrownError = e;
      }
      expect(thrownError).toBeDefined();
      expect(thrownError.classification).toBeDefined();
      expect(thrownError.classification.type).toBe("server");
      expect(thrownError.classification.isRetryable).toBe(true);
    });
  });
});
