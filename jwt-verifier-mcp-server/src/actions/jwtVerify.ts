/**
 * JWT Verification Tools
 * jwt_verify_signature and jwt_validate_claims
 */

import { z } from "zod";
import {
  verifyTokenSignature,
  validateClaims as validateClaimsService,
} from "../services/jwtVerifierService.js";
import { logger } from "../services/logger.js";
import { InvalidTokenError } from "../services/mcpErrors.js";

// ============================================================================
// JWT Verify Signature
// ============================================================================

const JwtVerifySignatureInputSchema = z.object({
  token: z.string().min(1, "Token cannot be empty").describe("The JWT to verify"),
  jwksUri: z.string().url().describe("JWKS endpoint URI (e.g., https://auth.example.com/.well-known/jwks.json)"),
  algorithms: z
    .array(z.string())
    .optional()
    .describe("Allowed algorithms (e.g., ['RS256', 'RS512']). If omitted, any algorithm is accepted."),
  issuer: z
    .string()
    .optional()
    .describe("Expected issuer claim (iss). If provided, token iss must match exactly."),
  audience: z
    .string()
    .optional()
    .describe("Expected audience claim (aud). If provided, token aud must include this value."),
});

export type JwtVerifySignatureInput = z.infer<typeof JwtVerifySignatureInputSchema>;

export interface JwtVerifySignatureOutput {
  valid: boolean;
  payload?: Record<string, unknown>;
  header?: Record<string, unknown>;
  algorithm?: string;
  kid?: string;
  error?: string;
}

/**
 * Verify JWT signature tool handler
 */
export async function handleJwtVerifySignature(
  input: unknown
): Promise<JwtVerifySignatureOutput> {
  try {
    const parsed = JwtVerifySignatureInputSchema.parse(input);

    logger.debug("Verifying JWT signature", {
      jwksUri: parsed.jwksUri,
      algorithms: parsed.algorithms,
      issuer: parsed.issuer ? "set" : "not set",
    } as any);

    const result = await verifyTokenSignature(parsed.token, parsed.jwksUri, {
      algorithms: parsed.algorithms,
      issuer: parsed.issuer,
      audience: parsed.audience,
    });

    if (result.valid) {
      logger.info("JWT signature verified successfully", {
        algorithm: result.algorithm,
      } as any);
    }

    return result;
  } catch (error) {
    logger.error("JWT signature verification failed", error as Error);
    throw error;
  }
}

export const jwtVerifySignatureToolDefinition = {
  name: "jwt_verify_signature",
  description:
    "Verify a JWT signature using a JWKS endpoint. Validates signature, algorithm, issuer, and audience.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "The JWT to verify",
      },
      jwksUri: {
        type: "string",
        description: "JWKS endpoint URL (e.g., https://auth.example.com/.well-known/jwks.json)",
      },
      algorithms: {
        type: "array",
        items: {
          type: "string",
        },
        description: "Allowed signing algorithms (e.g., ['RS256', 'RS512'])",
      },
      issuer: {
        type: "string",
        description: "Expected issuer (iss claim)",
      },
      audience: {
        type: "string",
        description: "Expected audience (aud claim)",
      },
    },
    required: ["token", "jwksUri"],
  },
};

// ============================================================================
// JWT Validate Claims
// ============================================================================

const JwtValidateClaimsInputSchema = z.object({
  token: z.string().min(1).describe("The JWT to validate claims for"),
  expectedIss: z
    .string()
    .optional()
    .describe("Expected issuer (iss claim)"),
  expectedAud: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Expected audience (aud claim). Can be a single value or array."),
  expectedNonce: z
    .string()
    .optional()
    .describe("Expected nonce claim"),
  clockToleranceSeconds: z
    .number()
    .int()
    .min(0)
    .max(3600)
    .optional()
    .describe("Clock tolerance for exp/nbf validation in seconds (default: 0)"),
});

export type JwtValidateClaimsInput = z.infer<typeof JwtValidateClaimsInputSchema>;

export interface JwtValidateClaimsOutput {
  valid: boolean;
  claimsChecked: string[];
  failures: string[];
  warnings: string[];
}

/**
 * Validate JWT claims tool handler
 */
export async function handleJwtValidateClaims(
  input: unknown
): Promise<JwtValidateClaimsOutput> {
  try {
    const parsed = JwtValidateClaimsInputSchema.parse(input);

    logger.debug("Validating JWT claims", {
      checks: {
        iss: !!parsed.expectedIss,
        aud: !!parsed.expectedAud,
        nonce: !!parsed.expectedNonce,
      },
    } as any);

    // Convert single string audience to array for internal handler
    const expectedAud = parsed.expectedAud
      ? Array.isArray(parsed.expectedAud)
        ? parsed.expectedAud
        : [parsed.expectedAud]
      : undefined;

    const result = validateClaimsService(parsed.token, {
      expectedIss: parsed.expectedIss,
      expectedAud,
      expectedNonce: parsed.expectedNonce,
      clockToleranceSeconds: parsed.clockToleranceSeconds,
    });

    if (result.valid) {
      logger.info("JWT claims validated successfully", {
        claimsChecked: result.claimsChecked,
      } as any);
    } else {
      logger.warn("JWT claims validation failed", {
        failures: result.failures,
      } as any);
    }

    return result;
  } catch (error) {
    logger.error("JWT claims validation failed", error as Error);
    throw error;
  }
}

export const jwtValidateClaimsToolDefinition = {
  name: "jwt_validate_claims",
  description:
    "Validate JWT standard claims (exp, nbf, iss, aud, nonce) without verifying signature.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "The JWT to validate",
      },
      expectedIss: {
        type: "string",
        description: "Expected issuer claim",
      },
      expectedAud: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
        description: "Expected audience claim (string or array of strings)",
      },
      expectedNonce: {
        type: "string",
        description: "Expected nonce claim",
      },
      clockToleranceSeconds: {
        type: "integer",
        description: "Clock tolerance in seconds (0-3600)",
        minimum: 0,
        maximum: 3600,
      },
    },
    required: ["token"],
  },
};
