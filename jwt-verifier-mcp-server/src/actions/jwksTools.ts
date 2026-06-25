/**
 * JWKS Tools
 * jwt_fetch_jwks and jwt_inspect_key
 */

import { z } from "zod";
import {
  fetchAndAnalyzeJwks,
  inspectJwksKey,
} from "../services/jwtVerifierService.js";
import { logger } from "../services/logger.js";

// ============================================================================
// Fetch JWKS
// ============================================================================

const JwtFetchJwksInputSchema = z.object({
  uri: z
    .string()
    .url()
    .describe("JWKS endpoint URI (e.g., https://auth.example.com/.well-known/jwks.json)"),
});

export type JwtFetchJwksInput = z.infer<typeof JwtFetchJwksInputSchema>;

export interface JwtFetchJwksOutput {
  keyCount: number;
  keys: Array<{
    kid?: string;
    kty: string;
    use?: string;
    alg?: string;
    hasPublicKey: boolean;
  }>;
  analysis: {
    algorithms: string[];
    keyUsages: string[];
  };
}

/**
 * Fetch and analyze JWKS tool handler
 */
export async function handleJwtFetchJwks(input: unknown): Promise<JwtFetchJwksOutput> {
  try {
    const parsed = JwtFetchJwksInputSchema.parse(input);

    logger.debug("Fetching JWKS", { uri: parsed.uri } as any);

    const result = await fetchAndAnalyzeJwks(parsed.uri);

    logger.info("JWKS fetched successfully", {
      keyCount: result.keyCount,
      algorithms: result.algorithms,
    } as any);

    return {
      keyCount: result.keyCount,
      keys: result.keys,
      analysis: {
        algorithms: result.algorithms,
        keyUsages: result.keyUsages,
      },
    };
  } catch (error) {
    logger.error("Failed to fetch JWKS", error as Error);
    throw error;
  }
}

export const jwtFetchJwksToolDefinition = {
  name: "jwt_fetch_jwks",
  description:
    "Fetch and analyze a JWKS endpoint. Returns all keys with metadata (kty, alg, use, kid) and summary of algorithms and key usages.",
  inputSchema: {
    type: "object",
    properties: {
      uri: {
        type: "string",
        description: "JWKS endpoint URL",
      },
    },
    required: ["uri"],
  },
};

// ============================================================================
// Inspect JWKS Key
// ============================================================================

const JwtInspectKeyInputSchema = z.object({
  key: z
    .record(z.unknown())
    .describe("A JWKS key object (JWK) from a JWKS response"),
});

export type JwtInspectKeyInput = z.infer<typeof JwtInspectKeyInputSchema>;

export interface JwtInspectKeyOutput {
  keyType: string;
  algorithm?: string;
  use?: string;
  kid?: string;
  isValid: boolean;
  issues: string[];
}

/**
 * Inspect a single JWKS key tool handler
 */
export async function handleJwtInspectKey(input: unknown): Promise<JwtInspectKeyOutput> {
  try {
    const parsed = JwtInspectKeyInputSchema.parse(input);

    logger.debug("Inspecting JWKS key", {
      kty: (parsed.key as any).kty,
      kid: (parsed.key as any).kid,
    } as any);

    const result = await inspectJwksKey(parsed.key as Record<string, unknown>);

    if (result.isValid) {
      logger.info("Key inspection completed", {
        keyType: result.keyType,
        algorithm: result.algorithm,
        kid: result.kid,
      } as any);
    } else {
      logger.warn("Key validation found issues", {
        keyType: result.keyType,
        issues: result.issues,
      } as any);
    }

    return result;
  } catch (error) {
    logger.error("Key inspection failed", error as Error);
    throw error;
  }
}

export const jwtInspectKeyToolDefinition = {
  name: "jwt_inspect_key",
  description:
    "Validate and analyze a single JWKS key. Checks key type, required components, and importability.",
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "object",
        description: "A JWKS key object (JWK)",
        additionalProperties: true,
      },
    },
    required: ["key"],
  },
};
