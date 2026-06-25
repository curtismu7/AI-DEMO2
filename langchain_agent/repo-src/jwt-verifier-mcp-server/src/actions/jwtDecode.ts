/**
 * JWT Decode Tool
 * Decodes a JWT without verification and returns all parts
 */

import { z } from "zod";
import { decodeToken } from "../services/jwtVerifierService.js";
import { logger } from "../services/logger.js";

const JwtDecodeInputSchema = z.object({
  token: z
    .string()
    .min(1, "Token cannot be empty")
    .describe("The JWT to decode (any format, no verification)"),
});

export type JwtDecodeInput = z.infer<typeof JwtDecodeInputSchema>;

export interface JwtDecodeOutput {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  hasSignature: boolean;
  summary: {
    algorithm?: string;
    type?: string;
    keyId?: string;
    issuedAt?: string;
    expiresAt?: string;
    subject?: string;
    issuer?: string;
  };
  isExpired: boolean;
}

/**
 * Decode JWT tool handler
 */
export async function handleJwtDecode(input: unknown): Promise<JwtDecodeOutput> {
  try {
    const parsed = JwtDecodeInputSchema.parse(input);

    logger.debug("Decoding JWT", { tokenLength: parsed.token.length } as any);

    const { header, payload, hasSignature } = decodeToken(parsed.token);

    // Build summary
    const now = Math.floor(Date.now() / 1000);
    const exp = typeof payload.exp === "number" ? payload.exp : null;
    const isExpired = exp ? exp < now : false;

    const summary = {
      algorithm: header.alg as string | undefined,
      type: header.typ as string | undefined,
      keyId: header.kid as string | undefined,
      issuedAt: typeof payload.iat === "number"
        ? new Date(payload.iat * 1000).toISOString()
        : undefined,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
      subject: payload.sub as string | undefined,
      issuer: payload.iss as string | undefined,
    };

    logger.info("JWT decoded successfully", {
      algorithm: summary.algorithm,
      isExpired,
    } as any);

    return {
      header,
      payload,
      hasSignature,
      summary,
      isExpired,
    };
  } catch (error) {
    logger.error("JWT decode failed", error as Error);
    throw error;
  }
}

export const jwtDecodeToolDefinition = {
  name: "jwt_decode_full",
  description:
    "Decode a JWT and return header, payload, and metadata. No verification performed.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "The JWT token to decode (unverified)",
      },
    },
    required: ["token"],
  },
};
