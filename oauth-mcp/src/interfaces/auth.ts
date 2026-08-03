/**
 * Authentication Interfaces
 * Core interfaces for PingOne authentication and token management
 */

import { MCPErrorCode } from './mcp';

export interface AgentTokenInfo {
  tokenHash: string;
  clientId: string;
  scopes: string[];
  expiresAt: Date;
  isValid: boolean;
  /** Populated when the token carries an RFC 8693 `act` claim — identifies the
   *  actor (e.g. Backend-for-Frontend (BFF) or AI agent client_id) that performed token exchange. */
  actorClientId?: string;
  /** Token exchange mode detected from introspection response.
   *  rfc_8693: standard delegated token with act claim (default).
   *  transaction_tokens: draft Transaction Tokens with txn_id claim. */
  tokenMode?: 'rfc_8693' | 'transaction_tokens';
  /** Transaction ID from Transaction Tokens draft (txn_id claim). */
  transactionId?: string;
  /** Transaction scope/intent from Transaction Tokens (txn_scope claim). */
  transactionScope?: string;
  /** True only when the JWT signature was cryptographically verified against JWKS.
   *  False means the token was accepted on the gateway's prior authorization
   *  (no JWKS configured, or a documented fail-open) — its claims are NOT proof
   *  of anything and must not drive an authorization decision. */
  signatureVerified?: boolean;
  /** Claims of the presented token, populated ONLY when signatureVerified is true.
   *  Undefined is the signal that no trustworthy claim source exists, so callers
   *  that authorize on claims (actor allow-list, D-05 audience contract) fail
   *  closed instead of falling back to an unverified base64 decode. */
  verifiedClaims?: Record<string, unknown>;
}

export interface UserTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
  issuedAt: Date;
}

export interface TokenInfo {
  active: boolean;
  scope?: string;
  client_id?: string;
  username?: string;
  token_type?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  aud?: string | string[];
  iss?: string;
  /** RFC 8693 §4.1 — present on delegated tokens issued via token exchange.
   *  Identifies the actor (client) that performed the exchange on behalf of `sub`.
   *  Nested `act` may appear for multi-hop delegation (e.g. MCP layer then agent). */
  act?: {
    client_id?: string;
    sub?: string;
    iss?: string;
    act?: { client_id?: string; sub?: string; iss?: string };
  };
  /** draft-oauth-transaction-tokens: Transaction ID, present only in Transaction Tokens mode. */
  txn_id?: string;
  /** draft-oauth-transaction-tokens: Transaction scope/intent. */
  txn_scope?: string;
  /** draft-oauth-transaction-tokens: Agent identifier in transaction token. */
  agent_id?: string;
}

export interface PingOneConfig {
  baseUrl: string;
  environmentId?: string;
  clientId: string;
  clientSecret: string;
  tokenIntrospectionEndpoint: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface Session {
  sessionId: string;
  agentTokenHash: string;
  userTokens?: UserTokens | UserTokens[];
  createdAt: Date;
  lastActivity: Date;
  expiresAt: Date;
}

export interface AuthorizationCodeExchangeRequest {
  grant_type: 'authorization_code';
  code: string;
  redirect_uri?: string;
  client_id: string;
  client_secret: string;
}

export interface TokenRefreshRequest {
  grant_type: 'refresh_token';
  refresh_token: string;
  client_id: string;
  client_secret: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  expiresAt: Date;
  codeVerifier?: string; // For PKCE flow
}

export enum AuthErrorCodes {
  INVALID_AGENT_TOKEN = MCPErrorCode.INVALID_TOKEN,
  USER_AUTHORIZATION_REQUIRED = MCPErrorCode.UNAUTHORIZED,
  TOKEN_EXPIRED = MCPErrorCode.TOKEN_EXPIRED,
  INSUFFICIENT_SCOPE = MCPErrorCode.INSUFFICIENT_SCOPE,
  TOKEN_REFRESH_FAILED = MCPErrorCode.INTERNAL_ERROR,
  INVALID_AUTHORIZATION_CODE = MCPErrorCode.INVALID_REQUEST,
  INVALID_PARAMS = MCPErrorCode.INVALID_PARAMS,
  INVALID_TOKEN = MCPErrorCode.INVALID_TOKEN
}

export class AuthenticationError extends Error {
  constructor(
    message: string,
    public code: AuthErrorCodes,
    public authorizationUrl?: string,
    public requiredScopes?: string[]
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}