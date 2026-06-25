export interface TratClaims {
  reqctx: { tool: string; session_id: string; correlation_id: string };
  purp: string;
  azd: { sub: string; act?: string; gateway?: string };
  rctx: { ip: string; user_agent: string; timestamp: string };
  trat_sim?: boolean;
}

/**
 * Extract TraT claims from the bearer JWT first, then fall back to
 * the X-TraT-Context header (simulation path).
 *
 * Returns null when tratMode is false or no claims are found.
 */
export function extractTratClaims(
  bearerToken: string,
  xTratContextHeader: string | undefined,
  tratMode: boolean,
): TratClaims | null {
  if (!tratMode) return null;

  // Path 1: claims embedded in the bearer JWT (PingOne native)
  try {
    const parts = bearerToken.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      if (typeof payload.purp === 'string' && typeof payload.reqctx?.tool === 'string' && payload.azd && payload.rctx) {
        return {
          reqctx: payload.reqctx,
          purp: payload.purp,
          azd: payload.azd,
          rctx: payload.rctx,
          trat_sim: payload.trat_sim,
        };
      }
    }
  } catch {
    // malformed JWT — fall through to header
  }

  // Path 2: simulation shim via X-TraT-Context header
  if (xTratContextHeader) {
    try {
      const parsed = JSON.parse(xTratContextHeader);
      if (typeof parsed.purp === 'string' && typeof parsed.reqctx?.tool === 'string' && parsed.azd && parsed.rctx) {
        return {
          reqctx: parsed.reqctx,
          purp: parsed.purp,
          azd: parsed.azd,
          rctx: parsed.rctx,
          trat_sim: parsed.trat_sim ?? true,
        };
      }
    } catch {
      // malformed header — return null
    }
  }

  return null;
}
