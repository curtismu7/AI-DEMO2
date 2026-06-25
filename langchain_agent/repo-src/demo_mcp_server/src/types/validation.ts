/**
 * Validation utilities for authentication, banking, and MCP protocol models
 */

import { AgentTokenInfo, UserTokens, AuthorizationRequest } from '../interfaces/auth';

/**
 * Validates AgentTokenInfo structure and data
 */
export function validateAgentTokenInfo(tokenInfo: any): tokenInfo is AgentTokenInfo {
  if (!tokenInfo || typeof tokenInfo !== 'object') {
    return false;
  }

  // Check required string fields
  if (typeof tokenInfo.tokenHash !== 'string' || tokenInfo.tokenHash.length === 0) {
    return false;
  }

  if (typeof tokenInfo.clientId !== 'string' || tokenInfo.clientId.length === 0) {
    return false;
  }

  // Check scopes array
  if (!Array.isArray(tokenInfo.scopes)) {
    return false;
  }

  if (!tokenInfo.scopes.every((scope: any) => typeof scope === 'string')) {
    return false;
  }

  // Check expiresAt is a valid Date
  if (!(tokenInfo.expiresAt instanceof Date) || isNaN(tokenInfo.expiresAt.getTime())) {
    return false;
  }

  // Check isValid is boolean
  if (typeof tokenInfo.isValid !== 'boolean') {
    return false;
  }

  return true;
}

/**
 * Validates UserTokens structure and data
 */
export function validateUserTokens(userTokens: any): userTokens is UserTokens {
  if (!userTokens || typeof userTokens !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStringFields = ['accessToken', 'refreshToken', 'tokenType', 'scope'];
  for (const field of requiredStringFields) {
    if (typeof userTokens[field] !== 'string' || userTokens[field].length === 0) {
      return false;
    }
  }

  // Check expiresIn is a positive number
  if (typeof userTokens.expiresIn !== 'number' || userTokens.expiresIn <= 0) {
    return false;
  }

  // Check issuedAt is a valid Date
  if (!(userTokens.issuedAt instanceof Date) || isNaN(userTokens.issuedAt.getTime())) {
    return false;
  }

  return true;
}

/**
 * Validates AuthorizationRequest structure and data
 */
export function validateAuthorizationRequest(authRequest: any): authRequest is AuthorizationRequest {
  if (!authRequest || typeof authRequest !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStringFields = ['authorizationUrl', 'state', 'scope', 'sessionId'];
  for (const field of requiredStringFields) {
    if (typeof authRequest[field] !== 'string' || authRequest[field].length === 0) {
      return false;
    }
  }

  // Validate URL format
  try {
    new URL(authRequest.authorizationUrl);
  } catch {
    return false;
  }

  // Check expiresAt is a valid Date
  if (!(authRequest.expiresAt instanceof Date) || isNaN(authRequest.expiresAt.getTime())) {
    return false;
  }

  return true;
}

/**
 * Validates if a token is expired
 */
export function isTokenExpired(expiresAt: Date): boolean {
  return new Date() >= expiresAt;
}

/**
 * Validates token format (basic JWT structure check)
 */
export function validateTokenFormat(token: string): boolean {
  if (typeof token !== 'string' || token.length === 0) {
    return false;
  }

  // Basic JWT format check (3 parts separated by dots)
  const parts = token.split('.');
  if (parts.length !== 3) {
    return false;
  }

  // Check each part is base64url encoded (basic check)
  const base64UrlRegex = /^[A-Za-z0-9_-]+$/;
  return parts.every(part => part.length > 0 && base64UrlRegex.test(part));
}

/**
 * Validates scope string format
 */
export function validateScopeFormat(scope: string): boolean {
  if (typeof scope !== 'string' || scope.length === 0) {
    return false;
  }

  // Check for leading/trailing spaces
  if (scope.trim() !== scope) {
    return false;
  }

  // Check for multiple consecutive spaces
  if (scope.includes('  ')) {
    return false;
  }

  // Scopes should be space-separated strings with valid characters
  const scopeRegex = /^[a-zA-Z0-9:._-]+(\s[a-zA-Z0-9:._-]+)*$/;
  return scopeRegex.test(scope);
}

/**
 * Validates session ID format (UUID v4)
 */
export function validateSessionIdFormat(sessionId: string): boolean {
  if (typeof sessionId !== 'string') {
    return false;
  }

  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where y is one of [8, 9, A, B] (or [8, 9, a, b])
  const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidV4Regex.test(sessionId);
}

// Banking validation functions

/**
 * Validates Account structure and data
 */
export function validateAccount(account: any): boolean {
  if (!account || typeof account !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStringFields = ['id', 'userId', 'accountType', 'accountNumber', 'status'];
  for (const field of requiredStringFields) {
    if (typeof account[field] !== 'string' || account[field].length === 0) {
      return false;
    }
  }

  // Check balance is a number
  if (typeof account.balance !== 'number' || isNaN(account.balance)) {
    return false;
  }

  // Check date strings
  const dateFields = ['createdAt', 'updatedAt'];
  for (const field of dateFields) {
    if (typeof account[field] !== 'string' || isNaN(Date.parse(account[field]))) {
      return false;
    }
  }

  return true;
}

/**
 * Validates Transaction structure and data
 */
export function validateTransaction(transaction: any): boolean {
  if (!transaction || typeof transaction !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStringFields = ['id', 'userId', 'createdAt'];
  for (const field of requiredStringFields) {
    if (typeof transaction[field] !== 'string' || transaction[field].length === 0) {
      return false;
    }
  }

  // Check amount is a positive number
  if (typeof transaction.amount !== 'number' || transaction.amount <= 0 || isNaN(transaction.amount)) {
    return false;
  }

  // Check type is valid
  const validTypes = ['deposit', 'withdrawal', 'transfer'];
  if (!validTypes.includes(transaction.type)) {
    return false;
  }

  // Check optional string fields
  const optionalStringFields = ['fromAccountId', 'toAccountId', 'description', 'performedBy', 'accountInfo'];
  for (const field of optionalStringFields) {
    if (transaction[field] !== undefined && (typeof transaction[field] !== 'string' || transaction[field].length === 0)) {
      return false;
    }
  }

  // Check createdAt is a valid date string
  if (isNaN(Date.parse(transaction.createdAt))) {
    return false;
  }

  // Validate transaction type constraints
  if (transaction.type === 'transfer') {
    if (!transaction.fromAccountId || !transaction.toAccountId) {
      return false;
    }
    if (transaction.fromAccountId === transaction.toAccountId) {
      return false;
    }
  } else if (transaction.type === 'withdrawal') {
    if (!transaction.fromAccountId) {
      return false;
    }
  } else if (transaction.type === 'deposit') {
    if (!transaction.toAccountId) {
      return false;
    }
  }

  return true;
}

/**
 * Validates TransactionRequest structure and data
 */
export function validateTransactionRequest(request: any): boolean {
  if (!request || typeof request !== 'object') {
    return false;
  }

  // Check amount is a positive number
  if (typeof request.amount !== 'number' || request.amount <= 0 || isNaN(request.amount)) {
    return false;
  }

  // Check type is valid
  const validTypes = ['deposit', 'withdrawal', 'transfer'];
  if (!validTypes.includes(request.type)) {
    return false;
  }

  // Check optional string fields
  const optionalStringFields = ['fromAccountId', 'toAccountId', 'description'];
  for (const field of optionalStringFields) {
    if (request[field] !== undefined && (typeof request[field] !== 'string' || request[field].length === 0)) {
      return false;
    }
  }

  // Validate transaction type constraints
  if (request.type === 'transfer') {
    if (!request.fromAccountId || !request.toAccountId) {
      return false;
    }
    if (request.fromAccountId === request.toAccountId) {
      return false;
    }
  } else if (request.type === 'withdrawal') {
    if (!request.fromAccountId) {
      return false;
    }
  } else if (request.type === 'deposit') {
    if (!request.toAccountId) {
      return false;
    }
  }

  return true;
}

/**
 * Validates banking tool parameters
 */
export function validateBankingToolParams(toolName: string, params: any): boolean {
  if (!params || typeof params !== 'object') {
    return false;
  }

  switch (toolName) {
    case 'get_my_accounts':
      // No parameters required
      return true;

    case 'get_account_balance':
      return typeof params.account_id === 'string' && params.account_id.length > 0;

    case 'get_my_transactions':
      // No parameters required
      return true;

    case 'create_deposit':
      return (
        typeof params.to_account_id === 'string' &&
        params.to_account_id.length > 0 &&
        typeof params.amount === 'number' &&
        params.amount > 0 &&
        !isNaN(params.amount) &&
        (params.description === undefined || (typeof params.description === 'string' && params.description.length <= 255))
      );

    case 'create_withdrawal':
      return (
        typeof params.from_account_id === 'string' &&
        params.from_account_id.length > 0 &&
        typeof params.amount === 'number' &&
        params.amount > 0 &&
        !isNaN(params.amount) &&
        (params.description === undefined || (typeof params.description === 'string' && params.description.length <= 255))
      );

    case 'create_transfer':
      return (
        typeof params.from_account_id === 'string' &&
        params.from_account_id.length > 0 &&
        typeof params.to_account_id === 'string' &&
        params.to_account_id.length > 0 &&
        params.from_account_id !== params.to_account_id &&
        typeof params.amount === 'number' &&
        params.amount > 0 &&
        !isNaN(params.amount) &&
        (params.description === undefined || (typeof params.description === 'string' && params.description.length <= 255))
      );

    default:
      return false;
  }
}

/**
 * Validates account ID format
 */
export function validateAccountId(accountId: string): boolean {
  if (typeof accountId !== 'string' || accountId.length === 0) {
    return false;
  }

  // Account ID should be alphanumeric with possible hyphens/underscores
  const accountIdRegex = /^[a-zA-Z0-9_-]+$/;
  return accountIdRegex.test(accountId) && accountId.length >= 3 && accountId.length <= 50;
}

/**
 * Validates monetary amount
 */
export function validateAmount(amount: number): boolean {
  if (typeof amount !== 'number' || isNaN(amount)) {
    return false;
  }

  // Amount should be positive and have at most 2 decimal places
  if (amount <= 0) {
    return false;
  }

  // Check for at most 2 decimal places
  const decimalPlaces = (amount.toString().split('.')[1] || '').length;
  return decimalPlaces <= 2;
}

// MCP Protocol validation functions

/**
 * Validates MCPMessage structure and data
 */
export function validateMCPMessage(message: any): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }

  // Check required string fields
  if (typeof message.id !== 'string' || message.id.length === 0) {
    return false;
  }

  if (typeof message.method !== 'string' || message.method.length === 0) {
    return false;
  }

  // Check params is object if present
  if (message.params !== undefined && (typeof message.params !== 'object' || message.params === null)) {
    return false;
  }

  return true;
}

/**
 * Validates MCPResponse structure and data
 */
export function validateMCPResponse(response: any): boolean {
  if (!response || typeof response !== 'object') {
    return false;
  }

  // Check required id field
  if (typeof response.id !== 'string' || response.id.length === 0) {
    return false;
  }

  // Must have either result or error, but not both
  const hasResult = response.result !== undefined;
  const hasError = response.error !== undefined;

  if (hasResult && hasError) {
    return false;
  }

  if (!hasResult && !hasError) {
    return false;
  }

  // Validate error structure if present
  if (hasError) {
    if (!validateMCPError(response.error)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates MCPError structure and data
 */
export function validateMCPError(error: any): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  // Check required fields
  if (typeof error.code !== 'number') {
    return false;
  }

  if (typeof error.message !== 'string' || error.message.length === 0) {
    return false;
  }

  return true;
}

/**
 * Validates ToolDefinition structure and data
 */
export function validateToolDefinition(tool: any): boolean {
  if (!tool || typeof tool !== 'object') {
    return false;
  }

  // Check required string fields
  const requiredStringFields = ['name', 'description'];
  for (const field of requiredStringFields) {
    if (typeof tool[field] !== 'string' || tool[field].length === 0) {
      return false;
    }
  }

  // Check inputSchema is valid JSON Schema
  if (!validateJSONSchema(tool.inputSchema)) {
    return false;
  }

  // Check requiresUserAuth is boolean
  if (typeof tool.requiresUserAuth !== 'boolean') {
    return false;
  }

  // Check requiredScopes is array of strings
  if (!Array.isArray(tool.requiredScopes)) {
    return false;
  }

  if (!tool.requiredScopes.every((scope: any) => typeof scope === 'string')) {
    return false;
  }

  return true;
}

/**
 * Validates JSONSchema structure (basic validation)
 */
export function validateJSONSchema(schema: any): boolean {
  if (!schema || typeof schema !== 'object') {
    return false;
  }

  // Check type field
  if (typeof schema.type !== 'string' || schema.type.length === 0) {
    return false;
  }

  // If properties exist, validate structure
  if (schema.properties !== undefined) {
    if (typeof schema.properties !== 'object' || schema.properties === null) {
      return false;
    }
  }

  // If required exists, validate it's an array of strings
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) {
      return false;
    }
    if (!schema.required.every((field: any) => typeof field === 'string')) {
      return false;
    }
  }

  return true;
}

/**
 * Validates ToolResult structure and data
 */
export function validateToolResult(result: any): boolean {
  if (!result || typeof result !== 'object') {
    return false;
  }

  // Check type field
  const validTypes = ['text', 'image', 'resource'];
  if (!validTypes.includes(result.type)) {
    return false;
  }

  // Check optional string fields
  const optionalStringFields = ['text', 'data', 'mimeType', 'error'];
  for (const field of optionalStringFields) {
    if (result[field] !== undefined && typeof result[field] !== 'string') {
      return false;
    }
  }

  // Check optional boolean fields
  const optionalBooleanFields = ['success'];
  for (const field of optionalBooleanFields) {
    if (result[field] !== undefined && typeof result[field] !== 'boolean') {
      return false;
    }
  }

  // Validate authChallenge if present
  if (result.authChallenge !== undefined) {
    if (!validateAuthorizationRequest(result.authChallenge)) {
      return false;
    }
  }

  return true;
}

/**
 * Validates HandshakeMessage structure and data
 */
export function validateHandshakeMessage(message: any): boolean {
  if (!validateMCPMessage(message)) {
    return false;
  }

  if (message.method !== 'initialize') {
    return false;
  }

  if (!message.params || typeof message.params !== 'object') {
    return false;
  }

  // Check protocolVersion
  if (typeof message.params.protocolVersion !== 'string' || message.params.protocolVersion.length === 0) {
    return false;
  }

  // Check capabilities
  if (!message.params.capabilities || typeof message.params.capabilities !== 'object') {
    return false;
  }

  return true;
}

/**
 * Validates ToolCallMessage structure and data
 */
export function validateToolCallMessage(message: any): boolean {
  if (!validateMCPMessage(message)) {
    return false;
  }

  if (message.method !== 'tools/call') {
    return false;
  }

  if (!message.params || typeof message.params !== 'object') {
    return false;
  }

  // Check name field
  if (typeof message.params.name !== 'string' || message.params.name.length === 0) {
    return false;
  }

  // Check arguments if present
  if (message.params.arguments !== undefined) {
    if (typeof message.params.arguments !== 'object' || message.params.arguments === null) {
      return false;
    }
  }

  return true;
}

/**
 * Validates MCP method name format
 */
export function validateMCPMethod(method: string): boolean {
  if (typeof method !== 'string' || method.length === 0) {
    return false;
  }

  // Valid MCP methods
  const validMethods = [
    'handshake',
    'tools/list',
    'tools/call',
    'logging/setLevel',
    'prompts/list',
    'prompts/get',
    'resources/list',
    'resources/read',
    'resources/subscribe',
    'resources/unsubscribe'
  ];

  return validMethods.includes(method);
}