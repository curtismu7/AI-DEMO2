/**
 * Authorization Manager for PingOne AI IAM Core
 * Handles user authorization code exchange and token refresh flows
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { 
  PingOneConfig, 
  UserTokens, 
  TokenResponse, 
  AuthorizationCodeExchangeRequest,
  TokenRefreshRequest,
  AuthenticationError, 
  AuthErrorCodes
} from '../interfaces/auth';
import { sanitizeAxiosCause } from '../utils/sanitizeAxiosCause';

export class AuthorizationManager {
  private httpClient: AxiosInstance;
  private config: PingOneConfig;

  constructor(config: PingOneConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Exchange authorization code for user access and refresh tokens
   */
  async exchangeAuthorizationCode(
    authCode: string, 
    redirectUri?: string,
    codeVerifier?: string
  ): Promise<UserTokens> {
    try {
      const requestData: AuthorizationCodeExchangeRequest = {
        grant_type: 'authorization_code',
        code: authCode,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      };

      if (redirectUri) {
        requestData.redirect_uri = redirectUri;
      }

      if (codeVerifier) {
        (requestData as any).code_verifier = codeVerifier;
      }

      console.log(`[AuthorizationManager] Exchanging authorization code:`);
      console.log(`[AuthorizationManager] Token endpoint: ${this.config.tokenEndpoint}`);
      console.log(`[AuthorizationManager] Request data:`, {
        grant_type: requestData.grant_type,
        code: authCode.substring(0, 10) + '...',
        client_id: requestData.client_id,
        redirect_uri: requestData.redirect_uri,
        code_verifier: codeVerifier ? codeVerifier.substring(0, 10) + '...' : undefined
      });

      const response = await this.httpClient.post(
        this.config.tokenEndpoint,
        new URLSearchParams(requestData as any).toString()
      );

      console.log(`[AuthorizationManager] Token exchange successful! Status: ${response.status}`);
      console.log(`[AuthorizationManager] Token response:`, {
        access_token: response.data.access_token ? response.data.access_token.substring(0, 20) + '...' : 'none',
        refresh_token: response.data.refresh_token ? response.data.refresh_token.substring(0, 20) + '...' : 'none',
        token_type: response.data.token_type,
        expires_in: response.data.expires_in,
        scope: response.data.scope
      });

      const tokenResponse: TokenResponse = response.data;
      const userTokens = this.mapTokenResponseToUserTokens(tokenResponse);
      
      console.log(`[AuthorizationManager] Mapped user tokens:`, {
        accessToken: userTokens.accessToken.substring(0, 20) + '...',
        refreshToken: userTokens.refreshToken ? userTokens.refreshToken.substring(0, 20) + '...' : 'none',
        tokenType: userTokens.tokenType,
        expiresIn: userTokens.expiresIn,
        scope: userTokens.scope
      });

      return userTokens;
    } catch (error) {
      console.error(`[AuthorizationManager] Token exchange failed:`, error);
      const cause = sanitizeAxiosCause(error);

      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        console.error(`[AuthorizationManager] HTTP Status: ${axiosError.response?.status}`);
        console.error(`[AuthorizationManager] Response data:`, axiosError.response?.data);

        if (axiosError.response?.status === 400) {
          const errorData = axiosError.response.data as any;
          if (errorData?.error === 'invalid_grant') {
            throw Object.assign(new AuthenticationError(
              'Invalid or expired authorization code',
              AuthErrorCodes.INVALID_AUTHORIZATION_CODE
            ), { cause });
          }
        }
        if (axiosError.response?.status === 401) {
          throw Object.assign(new AuthenticationError(
            'Invalid client credentials for token exchange',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          ), { cause });
        }
      }
      throw Object.assign(new Error(`Authorization code exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause });
    }
  }

  /**
   * Refresh user access token using refresh token
   */
  async refreshUserToken(refreshToken: string): Promise<UserTokens> {
    try {
      const requestData: TokenRefreshRequest = {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret
      };

      const response = await this.httpClient.post(
        this.config.tokenEndpoint,
        new URLSearchParams(requestData as any).toString()
      );

      const tokenResponse: TokenResponse = response.data;

      return this.mapTokenResponseToUserTokens(tokenResponse, refreshToken);
    } catch (error) {
      const cause = sanitizeAxiosCause(error);
      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 400) {
          const errorData = axiosError.response.data as any;
          if (errorData?.error === 'invalid_grant') {
            throw Object.assign(new AuthenticationError(
              'Invalid or expired refresh token',
              AuthErrorCodes.TOKEN_REFRESH_FAILED
            ), { cause });
          }
        }
        if (axiosError.response?.status === 401) {
          throw Object.assign(new AuthenticationError(
            'Invalid client credentials for token refresh',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          ), { cause });
        }
      }
      throw Object.assign(new Error(`Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`), { cause });
    }
  }

  /**
   * Validate that user tokens have the required banking scopes
   */
  validateBankingScopes(userTokens: UserTokens, requiredScopes: string[]): boolean {
    if (!userTokens.scope) {
      return false;
    }

    const tokenScopes = userTokens.scope.split(' ');
    return requiredScopes.every(scope => tokenScopes.includes(scope));
  }

  /**
   * Check if user tokens are expired or about to expire (within 5 minutes)
   */
  isTokenExpired(userTokens: UserTokens): boolean {
    const expirationTime = userTokens.issuedAt.getTime() + (userTokens.expiresIn * 1000);
    const bufferTime = 5 * 60 * 1000; // 5 minutes buffer
    return Date.now() >= (expirationTime - bufferTime);
  }

  /**
   * Get remaining token lifetime in seconds
   */
  getTokenLifetime(userTokens: UserTokens): number {
    const expirationTime = userTokens.issuedAt.getTime() + (userTokens.expiresIn * 1000);
    const remainingMs = expirationTime - Date.now();
    return Math.max(0, Math.floor(remainingMs / 1000));
  }

  /**
   * Map PingOne token response to UserTokens interface
   */
  private mapTokenResponseToUserTokens(
    tokenResponse: TokenResponse, 
    existingRefreshToken?: string
  ): UserTokens {
    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token || existingRefreshToken || '',
      tokenType: tokenResponse.token_type,
      expiresIn: tokenResponse.expires_in,
      scope: tokenResponse.scope || '',
      issuedAt: new Date()
    };
  }

  /**
   * Validate token response structure
   */
  private validateTokenResponse(tokenResponse: any): boolean {
    return !!(
      tokenResponse &&
      tokenResponse.access_token &&
      tokenResponse.token_type &&
      typeof tokenResponse.expires_in === 'number'
    );
  }

  /**
   * Extract error details from PingOne error response
   */
  private extractErrorDetails(errorResponse: any): { error: string; description?: string } {
    if (errorResponse && typeof errorResponse === 'object') {
      return {
        error: errorResponse.error || 'unknown_error',
        description: errorResponse.error_description
      };
    }
    return { error: 'unknown_error' };
  }
}