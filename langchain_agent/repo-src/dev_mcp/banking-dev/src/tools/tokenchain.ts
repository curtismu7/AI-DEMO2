import { z } from "zod";
import { decodeJwt, describeDecoded } from "../shared/jwt";
import { getEnv } from "../shared/env";
import { introspectToken } from "../shared/pingone";

export const tokenchainDecodeSchema = z.object({ jwt: z.string().min(20) });

export function tokenchainDecode(input: z.infer<typeof tokenchainDecodeSchema>): {
  decoded: ReturnType<typeof describeDecoded>;
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signaturePresent: boolean;
} {
  const d = decodeJwt(input.jwt);
  return {
    decoded: describeDecoded(d),
    header: d.header,
    payload: d.payload,
    signaturePresent: d.signaturePresent,
  };
}

export const tokenchainDiffSchema = z.object({
  jwt_a: z.string().min(20),
  jwt_b: z.string().min(20),
});

function asArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}

function scopesOf(s: string | undefined): string[] {
  return (s ?? "").trim().split(/\s+/).filter(Boolean);
}

export function tokenchainDiff(input: z.infer<typeof tokenchainDiffSchema>): {
  a: ReturnType<typeof describeDecoded>;
  b: ReturnType<typeof describeDecoded>;
  diff: {
    aud_added: string[];
    aud_removed: string[];
    scope_added: string[];
    scope_removed: string[];
    sub_changed: boolean;
    act_changed: boolean;
    may_act_changed: boolean;
    exp_delta_seconds: number | null;
  };
} {
  const a = describeDecoded(decodeJwt(input.jwt_a));
  const b = describeDecoded(decodeJwt(input.jwt_b));
  const audA = new Set(asArray(a.aud));
  const audB = new Set(asArray(b.aud));
  const scA = new Set(scopesOf(a.scope));
  const scB = new Set(scopesOf(b.scope));
  const expDelta =
    a.exp != null && b.exp != null ? b.exp - a.exp : null;
  return {
    a,
    b,
    diff: {
      aud_added: [...audB].filter((x) => !audA.has(x)),
      aud_removed: [...audA].filter((x) => !audB.has(x)),
      scope_added: [...scB].filter((x) => !scA.has(x)),
      scope_removed: [...scA].filter((x) => !scB.has(x)),
      sub_changed: a.sub !== b.sub,
      act_changed: JSON.stringify(a.act) !== JSON.stringify(b.act),
      may_act_changed: JSON.stringify(a.may_act) !== JSON.stringify(b.may_act),
      exp_delta_seconds: expDelta,
    },
  };
}

export const tokenchainIntrospectSchema = z.object({ token: z.string().min(20) });

export async function tokenchainIntrospect(
  input: z.infer<typeof tokenchainIntrospectSchema>
): Promise<{ active: boolean; claims: Record<string, unknown> }> {
  const result = await introspectToken(input.token);
  const active = result.active === true;
  return { active, claims: result };
}

export const tokenchainExplainSchema = z.object({
  token: z.string().min(20),
  expected_audience: z.string().optional(),
  expected_scopes: z.array(z.string()).optional(),
});

export function tokenchainExplain(input: z.infer<typeof tokenchainExplainSchema>): {
  verdict: "ok" | "warning" | "fail";
  reasons: string[];
  info: ReturnType<typeof describeDecoded>;
} {
  const info = describeDecoded(decodeJwt(input.token));
  const reasons: string[] = [];
  let verdict: "ok" | "warning" | "fail" = "ok";

  if (info.exp != null && info.expiresIn != null && info.expiresIn <= 0) {
    reasons.push(`Token expired ${-info.expiresIn}s ago`);
    verdict = "fail";
  } else if (info.expiresIn != null && info.expiresIn < 60) {
    reasons.push(`Token expires in ${info.expiresIn}s — refresh soon`);
    if (verdict === "ok") verdict = "warning";
  }

  const expectedAud =
    input.expected_audience ?? getEnv("PINGONE_RESOURCE_MCP_SERVER_URI");
  if (expectedAud) {
    const audList = asArray(info.aud);
    if (audList.length === 0) {
      reasons.push("No aud claim present");
      verdict = "fail";
    } else if (!audList.includes(expectedAud)) {
      reasons.push(
        `aud mismatch: token has [${audList.join(", ")}], expected ${expectedAud}`
      );
      verdict = "fail";
    }
  }

  const requiredScopes =
    input.expected_scopes ?? (getEnv("MCP_TOKEN_EXCHANGE_SCOPES") ?? "").split(/\s+/).filter(Boolean);
  if (requiredScopes.length > 0) {
    const tokenScopes = new Set(scopesOf(info.scope));
    const missing = requiredScopes.filter((s) => !tokenScopes.has(s));
    if (missing.length > 0) {
      reasons.push(`Missing scopes: ${missing.join(", ")}`);
      verdict = "fail";
    }
  }

  if (info.act == null) {
    reasons.push("act claim absent — RFC 8693 delegation not visible in token");
    if (verdict === "ok") verdict = "warning";
  }

  if (info.missingClaims.length > 0) {
    reasons.push(`Demo-required claims missing: ${info.missingClaims.join(", ")}`);
    if (verdict === "ok") verdict = "warning";
  }

  if (reasons.length === 0) reasons.push("All demo rules satisfied");
  return { verdict, reasons, info };
}
