/**
 * Authentication interfaces for banking operations
 */

export interface AuthenticationCredentials {
  username: string;
  password: string;
  accountId?: string;
}

export interface AuthenticationResult {
  success: boolean;
  token?: string;
  expiresAt?: Date;
  error?: string;
}

export interface AuthenticationProvider {
  authenticate(credentials: AuthenticationCredentials): Promise<AuthenticationResult>;
  validateToken(token: string): Promise<boolean>;
  refreshToken(token: string): Promise<AuthenticationResult>;
}

export interface SecureSession {
  sessionId: string;
  userId: string;
  accountId: string;
  token: string;
  expiresAt: Date;
  permissions: string[];
}

export interface AuthenticationConfig {
  provider: string;
  endpoint?: string;
  timeout?: number;
  retryAttempts?: number;
}