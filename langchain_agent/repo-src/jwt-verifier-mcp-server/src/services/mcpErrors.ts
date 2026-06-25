/**
 * MCP Error Handling
 * Decoupled error definitions and utilities
 */

export class McpError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "McpError";
    Object.setPrototypeOf(this, McpError.prototype);
  }
}

export class InvalidTokenError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("INVALID_TOKEN", message, details);
    this.name = "InvalidTokenError";
  }
}

export class VerificationFailedError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VERIFICATION_FAILED", message, details);
    this.name = "VerificationFailedError";
  }
}

export class JwksError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("JWKS_ERROR", message, details);
    this.name = "JwksError";
  }
}

export class ClaimsValidationError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CLAIMS_VALIDATION_ERROR", message, details);
    this.name = "ClaimsValidationError";
  }
}

export class ConfigError extends McpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFIG_ERROR", message, details);
    this.name = "ConfigError";
  }
}

/**
 * Converts an error to an MCP-compatible error response object
 */
export function errorToMcpResponse(
  error: unknown
): { isError: true; error: { code: string; message: string } } {
  if (error instanceof McpError) {
    return {
      isError: true,
      error: {
        code: error.code,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      isError: true,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
      },
    };
  }

  return {
    isError: true,
    error: {
      code: "UNKNOWN_ERROR",
      message: String(error),
    },
  };
}
