'use strict';

/**
 * intentTokenValidator — gateway-side validation for BFF-minted Intent Tokens.
 *
 * Intent Tokens are HMAC-SHA256 JWTs minted by the BFF at prompt-receipt time.
 * They bind the user's original intent to a cryptographic token that the agent
 * cannot modify. The gateway validates the signature and checks that the
 * requested tool is in the `permitted_tools` claim before forwarding the
 * authorization decision to PingAuthorize.
 *
 * Env var: INTENT_TOKEN_SECRET (shared between BFF and gateway).
 * Fallback: SESSION_SECRET (for local dev where both run from the same .env).
 */

import * as crypto from 'node:crypto';

export interface IntentTokenPayload {
  jti: string;
  iss: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  prompt_hash: string;
  intent: string;
  confidence: number;
  permitted_tools: string[];
  vertical: string;
}

export interface IntentValidationResult {
  valid: boolean;
  payload?: IntentTokenPayload;
  error?: string;
  toolPermitted?: boolean;
}

function getSigningKey(): string {
  const key = process.env.INTENT_TOKEN_SECRET || process.env.SESSION_SECRET;
  if (!key) throw new Error('[intentTokenValidator] INTENT_TOKEN_SECRET not configured');
  return key;
}

/**
 * Validate an Intent Token and check whether `toolName` is in its permitted_tools.
 *
 * @param token     - raw JWT string from X-Intent-Token header (may be undefined)
 * @param toolName  - the MCP tool name the agent wants to call
 */
export function validateIntentToken(
  token: string | undefined,
  toolName: string,
): IntentValidationResult {
  if (!token) {
    return { valid: false, error: 'no_intent_token', toolPermitted: false };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'malformed', toolPermitted: false };
  }

  const [headerB64, bodyB64, sig] = parts;

  let key: string;
  try {
    key = getSigningKey();
  } catch {
    return { valid: false, error: 'no_signing_key', toolPermitted: false };
  }

  const expectedSig = crypto
    .createHmac('sha256', key)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return { valid: false, error: 'invalid_signature', toolPermitted: false };
  }

  let payload: IntentTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8')) as IntentTokenPayload;
  } catch {
    return { valid: false, error: 'malformed_payload', toolPermitted: false };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp < nowSec) {
    return { valid: false, error: 'expired', toolPermitted: false };
  }

  const toolPermitted =
    Array.isArray(payload.permitted_tools) && payload.permitted_tools.includes(toolName);

  return { valid: true, payload, toolPermitted };
}
