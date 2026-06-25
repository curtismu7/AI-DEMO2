// JWT decode WITHOUT signature validation. Signature validation is a different
// debugging axis and lives in banking_api_server/services/tokenIntrospectionService.

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
}

function b64urlDecode(seg: string): string {
  const pad = seg.length % 4 === 0 ? "" : "=".repeat(4 - (seg.length % 4));
  const b64 = (seg + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split(".");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Not a JWT — expected 2 or 3 segments, got ${parts.length}`);
  }
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
  } catch {
    throw new Error("JWT header is not valid JSON");
  }
  try {
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    throw new Error("JWT payload is not valid JSON");
  }
  return { header, payload, signaturePresent: parts.length === 3 && parts[2].length > 0 };
}

const DEMO_REQUIRED_CLAIMS = ["sub", "aud", "scope", "exp", "iat"] as const;

export function describeDecoded(d: DecodedJwt): {
  alg: string | undefined;
  kid: string | undefined;
  sub: string | undefined;
  aud: string[] | string | undefined;
  scope: string | undefined;
  act: unknown;
  may_act: unknown;
  acr: unknown;
  exp: number | undefined;
  iat: number | undefined;
  expiresIn: number | null;
  missingClaims: string[];
} {
  const p = d.payload;
  const now = Math.floor(Date.now() / 1000);
  const exp = typeof p.exp === "number" ? (p.exp as number) : undefined;
  const missing = DEMO_REQUIRED_CLAIMS.filter((k) => !(k in p));
  return {
    alg: typeof d.header.alg === "string" ? (d.header.alg as string) : undefined,
    kid: typeof d.header.kid === "string" ? (d.header.kid as string) : undefined,
    sub: typeof p.sub === "string" ? (p.sub as string) : undefined,
    aud: (p.aud as string | string[] | undefined) ?? undefined,
    scope: typeof p.scope === "string" ? (p.scope as string) : undefined,
    act: p.act,
    may_act: p.may_act,
    acr: p.acr,
    exp,
    iat: typeof p.iat === "number" ? (p.iat as number) : undefined,
    expiresIn: exp != null ? exp - now : null,
    missingClaims: missing,
  };
}
