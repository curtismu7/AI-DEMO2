/**
 * Token Exchange Interfaces for RFC 8693 Compliance
 * Defines request/response structures for OAuth 2.0 Token Exchange
 */

export interface TokenExchangeRequest {
  grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange';
  subject_token: string;
  subject_token_type: 'urn:ietf:params:oauth:token-type:access_token';
  actor_token?: string;
  actor_token_type?: 'urn:ietf:params:oauth:token-type:access_token';
  requested_token_type?: string;
  resource?: string | string[];
  audience?: string | string[];
  scope?: string;
}

export interface TokenExchangeResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope?: string;
  issued_token_type?: string;
  refresh_token?: string;
}

export interface MayActClaim {
  client_id: string;
  sub?: string;
  act?: {
    client_id?: string;
    sub?: string;
  };
}

export interface ActClaim {
  client_id?: string;
  sub?: string;
  act?: {
    client_id?: string;
    sub?: string;
  };
}

export interface DelegationTokenInfo {
  sub: string;
  aud: string | string[];
  iss: string;
  exp: number;
  iat: number;
  scope: string;
  client_id: string;
  may_act?: MayActClaim;
  act?: ActClaim;
  resource?: string | string[];
  cnf?: {
    jkt?: string;
    x5t?: string;
  };
}

export interface TokenExchangeValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  tokenInfo: DelegationTokenInfo;
}

export interface TokenExchangeConfig {
  pingoneBaseUrl: string;
  environmentId: string;
  /** Explicit token endpoint URL. When set, overrides the baseUrl+environmentId construction. */
  tokenEndpoint?: string;
  clientId: string;
  clientSecret: string;
  requireMayAct: boolean;
  bffClientId?: string;
  expectedActClientId?: string;
  expectedActSub?: string;
  resourceUri?: string;
}

export interface TokenExchangeError {
  error: string;
  error_description?: string;
  error_code?: number;
  timestamp: string;
  request_id?: string;
}

export enum TokenExchangeErrorCodes {
  INVALID_REQUEST = 'invalid_request',
  INVALID_CLIENT = 'invalid_client',
  INVALID_GRANT = 'invalid_grant',
  UNAUTHORIZED_CLIENT = 'unauthorized_client',
  UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
  INVALID_SCOPE = 'invalid_scope',
  INVALID_TOKEN = 'invalid_token',
  INSUFFICIENT_SCOPE = 'insufficient_scope',
  INVALID_ACTOR_TOKEN = 'invalid_actor_token',
  INVALID_SUBJECT_TOKEN = 'invalid_subject_token',
  INVALID_REQUESTED_TOKEN_TYPE = 'invalid_requested_token_type'
}

export interface ResourceIndicator {
  resource: string;
  audience?: string | string[];
  type: 'api' | 'resource' | 'service';
  description?: string;
}

export interface ScopeDefinition {
  name: string;
  description: string;
  type: 'delegation' | 'access' | 'admin';
  required?: boolean;
  sensitive?: boolean;
  delegation_chain?: boolean;
}

export interface TokenExchangeAudit {
  timestamp: string;
  operation: 'token_exchange' | 'token_validation' | 'token_introspection';
  client_id: string;
  subject: string;
  actor?: string;
  scopes: string[];
  resource?: string;
  audience?: string | string[];
  success: boolean;
  error?: string;
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
}
