/**
 * Tests for Token Introspection Middleware (RFC 7662)
 *
 * After Phase 245 consolidation, the middleware delegates all introspection
 * to tokenIntrospectionService. Tests mock the service layer, not axios directly.
 */

const {
  tokenIntrospectionMiddleware,
  optionalTokenIntrospectionMiddleware,
  introspectToken,
  clearIntrospectionCache,
} = require("../../middleware/tokenIntrospection");

// Mock the service that the middleware now delegates to (Phase 245 consolidation)
jest.mock("../../services/tokenIntrospectionService", () => ({
  validateToken: jest.fn(),
  clearCache: jest.fn(),
}));

jest.mock("../../utils/logger", () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { logger: mockLogger, LOG_LEVELS: {}, LOG_CATEGORIES: {} };
});

const tokenIntrospectionService = require("../../services/tokenIntrospectionService");

describe("Token Introspection Middleware", () => {
  const mockToken = "mock.access.token";

  beforeEach(() => {
    jest.clearAllMocks();
    clearIntrospectionCache();
  });

  describe("introspectToken", () => {
    it("should successfully introspect active token", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({
        valid: true,
        scopes: ["openid", "profile"],
        sub: "user123",
        client_id: "client123",
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      });

      const result = await introspectToken(mockToken);

      expect(result.active).toBe(true);
      expect(result.sub).toBe("user123");
      expect(result.scope).toBe("openid profile");
      // introspectToken now forwards an opts object (default {}) for optional
      // issuing-client self-introspection.
      expect(tokenIntrospectionService.validateToken).toHaveBeenCalledWith(mockToken, {});
    });

    it("forwards issuing-client creds opts to validateToken (self-introspection)", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: true, scopes: [], sub: "u" });
      const opts = { clientId: "user-app", clientSecret: "shh", authMethod: "post" };
      await introspectToken(mockToken, opts);
      expect(tokenIntrospectionService.validateToken).toHaveBeenCalledWith(mockToken, opts);
    });

    it("should return inactive for revoked token", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: false, scopes: [] });
      const result = await introspectToken(mockToken);
      expect(result.active).toBe(false);
    });

    it("should handle service errors", async () => {
      tokenIntrospectionService.validateToken.mockRejectedValue(new Error("Network error"));
      await expect(introspectToken(mockToken)).rejects.toThrow("Network error");
    });

    it("should normalize scopes array to space-joined string", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: true, scopes: ["openid", "profile", "email"], sub: "user123" });
      const result = await introspectToken(mockToken);
      expect(result.scope).toBe("openid profile email");
    });

    it("should return active:false when valid is false", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: false });
      const result = await introspectToken(mockToken);
      expect(result.active).toBe(false);
    });
  });

  describe("tokenIntrospectionMiddleware", () => {
    let req, res, next;

    beforeEach(() => {
      req = { headers: { authorization: "Bearer " + mockToken }, path: "/api/accounts" };
      res = {};
      next = jest.fn();
    });

    it("should allow request with active token", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: true, scopes: ["openid", "profile"], sub: "user123", client_id: "client123" });
      await tokenIntrospectionMiddleware(req, res, next);
      expect(req.tokenIntrospection).toBeDefined();
      expect(req.tokenIntrospection.active).toBe(true);
      expect(req.tokenIntrospection.sub).toBe("user123");
      expect(next).toHaveBeenCalledWith();
    });

    it("should reject request with inactive token", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: false, scopes: [], sub: "user123" });
      await tokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("not active") }));
    });

    it("should skip if no authorization header", async () => {
      delete req.headers.authorization;
      await tokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(tokenIntrospectionService.validateToken).not.toHaveBeenCalled();
    });

    it("should skip if not Bearer token", async () => {
      req.headers.authorization = "Basic credentials";
      await tokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(tokenIntrospectionService.validateToken).not.toHaveBeenCalled();
    });

    it("should fail closed by default on errors", async () => {
      tokenIntrospectionService.validateToken.mockRejectedValue(new Error("Network error"));
      await tokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Network error") }));
    });

    it("should fail open when configured", async () => {
      process.env.INTROSPECTION_FAIL_OPEN = "true";
      tokenIntrospectionService.validateToken.mockRejectedValue(new Error("Network error"));
      await tokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(req.introspectionFailedOpen).toBe(true);
      delete process.env.INTROSPECTION_FAIL_OPEN;
    });

    it("should attach introspection result to request", async () => {
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: true, scopes: ["openid", "profile", "email"], sub: "user123", client_id: "client123", exp: 1234567890, iat: 1234567800 });
      await tokenIntrospectionMiddleware(req, res, next);
      expect(req.tokenIntrospection).toMatchObject({ active: true, sub: "user123", client_id: "client123" });
    });
  });

  describe("optionalTokenIntrospectionMiddleware", () => {
    let req, res, next;

    beforeEach(() => {
      req = { headers: { authorization: "Bearer " + mockToken }, path: "/api/accounts" };
      res = {};
      next = jest.fn();
    });

    it("should skip introspection when not enabled", async () => {
      process.env.ENABLE_TOKEN_INTROSPECTION = "false";
      await optionalTokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(tokenIntrospectionService.validateToken).not.toHaveBeenCalled();
      delete process.env.ENABLE_TOKEN_INTROSPECTION;
    });

    it("should perform introspection when enabled", async () => {
      process.env.ENABLE_TOKEN_INTROSPECTION = "true";
      tokenIntrospectionService.validateToken.mockResolvedValue({ valid: true, scopes: [], sub: "user123" });
      await optionalTokenIntrospectionMiddleware(req, res, next);
      expect(tokenIntrospectionService.validateToken).toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      delete process.env.ENABLE_TOKEN_INTROSPECTION;
    });

    it("should skip by default if env var not set", async () => {
      delete process.env.ENABLE_TOKEN_INTROSPECTION;
      await optionalTokenIntrospectionMiddleware(req, res, next);
      expect(next).toHaveBeenCalledWith();
      expect(tokenIntrospectionService.validateToken).not.toHaveBeenCalled();
    });
  });

  describe("clearIntrospectionCache", () => {
    it("should delegate cache clear to service", () => {
      clearIntrospectionCache();
      expect(tokenIntrospectionService.clearCache).toHaveBeenCalled();
    });
  });
});
