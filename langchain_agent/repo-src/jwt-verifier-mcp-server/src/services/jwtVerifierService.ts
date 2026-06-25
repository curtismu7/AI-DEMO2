/**
 * JWT Verifier Service
 * Core JWT operations using jose library
 */

import {
  jwtVerify as joseJwtVerify,
  createRemoteJWKSet,
  importSPKI,
  importJWK,
  decodeProtectedHeader,
  decodeJwt,
} from "jose";
import axios from "axios";
import { logger } from "./logger.js";
import {
  InvalidTokenError,
  VerificationFailedError,
  JwksError,
  ClaimsValidationError,
} from "./mcpErrors.js";

const HTTP_TIMEOUT = parseInt(process.env.HTTP_TIMEOUT_MS || "10000");
const MAX_JWKS_SIZE = parseInt(process.env.MAX_JWKS_SIZE || "1048576");

export interface TokenParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  hasSignature: boolean;
}

export interface VerificationResult {
  valid: boolean;
  payload?: Record<string, unknown>;
  header?: Record<string, unknown>;
  algorithm?: string;
  kid?: string;
  error?: string;
}

export interface ClaimsValidationResult {
  valid: boolean;
  claimsChecked: string[];
  failures: string[];
  warnings: string[];
}

export interface JwksAnalysis {
  keyCount: number;
  keys: Array<{
    kid?: string;
    kty: string;
    use?: string;
    alg?: string;
    hasPublicKey: boolean;
  }>;
  algorithms: string[];
  keyUsages: string[];
}

/**
 * Decode and parse a JWT without verification
 */
export function decodeToken(token: string): TokenParts {
  try {
    // Split by dots to check structure
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new InvalidTokenError("Token must have 3 parts (header.payload.signature)", {
        parts: parts.length,
      });
    }

    // Decode header
    const header = decodeProtectedHeader(token);

    // Decode payload
    const payload = decodeJwt(token);

    return {
      header,
      payload,
      hasSignature: !!parts[2],
    };
  } catch (error) {
    if (error instanceof InvalidTokenError) throw error;
    throw Object.assign(new InvalidTokenError(`Failed to decode token: ${String(error)}`), { cause: error });
  }
}

/**
 * Verify JWT signature using a JWKS URI
 */
export async function verifyTokenSignature(
  token: string,
  jwksUri: string,
  options?: {
    algorithms?: string[];
    issuer?: string;
    audience?: string;
  }
): Promise<VerificationResult> {
  try {
    const header = decodeProtectedHeader(token);
    const jwkSet = createRemoteJWKSet(new URL(jwksUri), {
      cooldownDuration: 30000, // 30s cache
    });

    const verifyOptions: any = {
      algorithms: options?.algorithms,
      ...(options?.issuer && { issuer: options.issuer }),
      ...(options?.audience && { audience: options.audience }),
    };

    const verified = await joseJwtVerify(token, jwkSet, verifyOptions);

    return {
      valid: true,
      payload: verified.payload as Record<string, unknown>,
      header: header as Record<string, unknown>,
      algorithm: (header as Record<string, unknown>).alg as string,
      kid: (header as Record<string, unknown>).kid as string,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Token signature verification failed", { error: message } as any);
    return {
      valid: false,
      error: message,
    };
  }
}

/**
 * Verify JWT signature using a PEM-encoded public key
 */
export async function verifyTokenWithKey(
  token: string,
  publicKeyPem: string,
  algorithms: string[] = ["RS256", "RS512"]
): Promise<VerificationResult> {
  try {
    const header = decodeProtectedHeader(token);
    const publicKey = await importSPKI(publicKeyPem, (header as Record<string, unknown>).alg as string);

    const verified = await joseJwtVerify(token, publicKey, {
      algorithms,
    });

    return {
      valid: true,
      payload: verified.payload as Record<string, unknown>,
      header: header as Record<string, unknown>,
      algorithm: (header as Record<string, unknown>).alg as string,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Token verification with key failed", { error: message } as any);
    return {
      valid: false,
      error: message,
    };
  }
}

/**
 * Validate token claims
 */
export function validateClaims(
  token: string,
  options?: {
    expectedIss?: string;
    expectedAud?: string | string[];
    expectedNonce?: string;
    clockToleranceSeconds?: number;
  }
): ClaimsValidationResult {
  const result: ClaimsValidationResult = {
    valid: true,
    claimsChecked: [],
    failures: [],
    warnings: [],
  };

  try {
    const payload = decodeJwt(token) as Record<string, unknown>;
    const now = Math.floor(Date.now() / 1000);
    const clockTolerance = options?.clockToleranceSeconds || 0;

    // Check exp (expiration)
    result.claimsChecked.push("exp");
    if (typeof payload.exp === "number") {
      if (payload.exp < now - clockTolerance) {
        result.failures.push(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
        result.valid = false;
      }
    } else if (payload.exp) {
      result.warnings.push("exp claim present but not a number");
    }

    // Check nbf (not before)
    result.claimsChecked.push("nbf");
    if (typeof payload.nbf === "number") {
      if (payload.nbf > now + clockTolerance) {
        result.failures.push(
          `Token not yet valid, starts at ${new Date(payload.nbf * 1000).toISOString()}`
        );
        result.valid = false;
      }
    }

    // Check iss (issuer)
    if (options?.expectedIss) {
      result.claimsChecked.push("iss");
      if (payload.iss !== options.expectedIss) {
        result.failures.push(
          `Issuer mismatch: expected "${options.expectedIss}", got "${String(payload.iss)}"`
        );
        result.valid = false;
      }
    }

    // Check aud (audience)
    if (options?.expectedAud) {
      result.claimsChecked.push("aud");
      const expectedAudArray = Array.isArray(options.expectedAud)
        ? options.expectedAud
        : [options.expectedAud];

      if (Array.isArray(payload.aud)) {
        const match = expectedAudArray.some((exp) => (payload.aud as string[]).includes(exp));
        if (!match) {
          result.failures.push(
            `Audience mismatch: expected one of ${JSON.stringify(expectedAudArray)}, got ${JSON.stringify(payload.aud)}`
          );
          result.valid = false;
        }
      } else if (typeof payload.aud === "string") {
        if (!expectedAudArray.includes(payload.aud)) {
          result.failures.push(
            `Audience mismatch: expected one of ${JSON.stringify(expectedAudArray)}, got "${payload.aud}"`
          );
          result.valid = false;
        }
      }
    }

    // Check nonce
    if (options?.expectedNonce) {
      result.claimsChecked.push("nonce");
      if (payload.nonce !== options.expectedNonce) {
        result.failures.push(
          `Nonce mismatch: expected "${options.expectedNonce}", got "${String(payload.nonce)}"`
        );
        result.valid = false;
      }
    }

    return result;
  } catch (error) {
    throw Object.assign(new ClaimsValidationError(`Failed to validate claims: ${String(error)}`), { cause: error });
  }
}

/**
 * Fetch and analyze JWKS
 */
export async function fetchAndAnalyzeJwks(jwksUri: string): Promise<JwksAnalysis> {
  try {
    const response = await axios.get(jwksUri, {
      timeout: HTTP_TIMEOUT,
      maxContentLength: MAX_JWKS_SIZE,
    } as any);

    const jwksData = response.data;

    if (!jwksData.keys || !Array.isArray(jwksData.keys)) {
      throw new JwksError("JWKS response missing 'keys' array");
    }

    const algorithms = new Set<string>();
    const keyUsages = new Set<string>();
    const keys = jwksData.keys.map(
      (key: Record<string, unknown>) => {
        if (typeof key.alg === "string") algorithms.add(key.alg);
        if (typeof key.use === "string") keyUsages.add(key.use);

        return {
        kid: key.kid as string | undefined,
        kty: key.kty as string,
        use: key.use as string | undefined,
        alg: key.alg as string | undefined,
        hasPublicKey: !!(key.n || key.x), // Check for RSA modulus or EC x-coordinate
        };
      }
    );

    return {
      keyCount: keys.length,
      keys,
      algorithms: Array.from(algorithms),
      keyUsages: Array.from(keyUsages),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw Object.assign(new JwksError(`Failed to fetch JWKS from ${jwksUri}: ${message}` as any), { cause: error });
  }
}

/**
 * Inspect a single JWKS key
 */
export async function inspectJwksKey(
  keyData: Record<string, unknown>
): Promise<{
  keyType: string;
  algorithm?: string;
  use?: string;
  kid?: string;
  isValid: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Validate required fields
  if (!keyData.kty) issues.push("Missing 'kty' (key type)");

  // Validate by key type
  if (keyData.kty === "RSA") {
    if (!keyData.n || !keyData.e) {
      issues.push("RSA key missing required components (n, e)");
    }
  } else if (keyData.kty === "EC") {
    if (!keyData.crv || !keyData.x || !keyData.y) {
      issues.push("EC key missing required components (crv, x, y)");
    }
  } else if (keyData.kty === "oct") {
    if (!keyData.k) {
      issues.push("Symmetric key missing 'k' component");
    }
  }

  // Check if we can import it
  let canImport = issues.length === 0;
  if (canImport && (keyData.kty === "RSA" || keyData.kty === "EC")) {
    try {
      await importJWK(keyData as any, (keyData.alg as string) || "RS256");
    } catch (error) {
      canImport = false;
      issues.push(`Cannot import key: ${String(error)}`);
    }
  }

  return {
    keyType: String(keyData.kty),
    algorithm: keyData.alg as string | undefined,
    use: keyData.use as string | undefined,
    kid: keyData.kid as string | undefined,
    isValid: canImport && issues.length === 0,
    issues,
  };
}
