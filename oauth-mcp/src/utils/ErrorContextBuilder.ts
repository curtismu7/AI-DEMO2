/**
 * Error Context Builder for MCP Error Responses
 * Provides structured error context and debugging information
 */

import { MCPErrorCode } from '../interfaces/mcp';

export interface ErrorContext {
  type: 'http' | 'json_rpc' | 'authentication' | 'banking';
  details?: any;
  stack?: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  toolName?: string;
  requestPath?: string;
  server: string;
  version: string;
}

export class ErrorContextBuilder {
  static build(
    code: MCPErrorCode,
    message: string,
    type: 'http' | 'json_rpc' | 'authentication' | 'banking',
    details?: any,
    requestId?: string,
    context?: {
      userId?: string;
      sessionId?: string;
      toolName?: string;
      requestPath?: string;
    }
  ): {
    code: MCPErrorCode;
    message: string;
    data: ErrorContext;
  } {
    return {
      code,
      message,
      data: {
        type,
        details,
        stack: new Error().stack,
        timestamp: new Date().toISOString(),
        requestId,
        userId: context?.userId,
        sessionId: context?.sessionId,
        toolName: context?.toolName,
        requestPath: context?.requestPath,
        server: 'Demo MCP Server',
        version: process.env.npm_package_version || '1.0.0'
      }
    };
  }

  static buildHttpError(
    code: MCPErrorCode,
    message: string,
    details?: any,
    requestId?: string,
    context?: {
      userId?: string;
      sessionId?: string;
      requestPath?: string;
    }
  ): {
    error: string;
    error_description: string;
    error_code: MCPErrorCode;
    resource_metadata?: string;
    timestamp: string;
    request_id?: string;
    data: ErrorContext;
  } {
    const baseError = this.build(code, message, 'http', details, requestId, context);
    
    return {
      error: this.mapCodeToErrorString(code),
      error_description: message,
      error_code: code,
      resource_metadata: details?.resource_metadata,
      timestamp: baseError.data.timestamp,
      request_id: requestId,
      data: baseError.data
    };
  }

  static mapCodeToErrorString(code: MCPErrorCode): string {
    switch (code) {
      case MCPErrorCode.UNAUTHORIZED:
        return 'unauthorized';
      case MCPErrorCode.FORBIDDEN:
        return 'forbidden';
      case MCPErrorCode.INSUFFICIENT_SCOPE:
        return 'insufficient_scope';
      case MCPErrorCode.INVALID_TOKEN:
        return 'invalid_token';
      case MCPErrorCode.TOKEN_EXPIRED:
        return 'token_expired';
      case MCPErrorCode.PARSE_ERROR:
        return 'parse_error';
      case MCPErrorCode.INVALID_REQUEST:
        return 'invalid_request';
      case MCPErrorCode.METHOD_NOT_FOUND:
        return 'method_not_found';
      case MCPErrorCode.INVALID_PARAMS:
        return 'invalid_params';
      case MCPErrorCode.INTERNAL_ERROR:
        return 'internal_error';
      case MCPErrorCode.TOOL_NOT_FOUND:
        return 'tool_not_found';
      case MCPErrorCode.TOOL_EXECUTION_ERROR:
        return 'tool_execution_error';
      case MCPErrorCode.RATE_LIMITED:
        return 'rate_limited';
      case MCPErrorCode.ACCOUNT_NOT_FOUND:
        return 'account_not_found';
      case MCPErrorCode.INSUFFICIENT_FUNDS:
        return 'insufficient_funds';
      case MCPErrorCode.TRANSACTION_FAILED:
        return 'transaction_failed';
      case MCPErrorCode.INVALID_AMOUNT:
        return 'invalid_amount';
      case MCPErrorCode.ACCOUNT_LOCKED:
        return 'account_locked';
      default:
        return 'unknown_error';
    }
  }
}

export class ErrorLogger {
  static log(error: any, context?: {
    userId?: string;
    sessionId?: string;
    toolName?: string;
    requestPath?: string;
  }): void {
    const logEntry = {
      timestamp: error.data?.timestamp || new Date().toISOString(),
      code: error.code || error.error_code,
      message: error.message || error.error_description,
      type: error.data?.type || 'unknown',
      details: error.data?.details,
      context,
      level: this.getLogLevel(error.code || error.error_code),
      server: error.data?.server || 'Super Banking MCP Server',
      version: error.data?.version || '1.0.0'
    };
    
    console.error(JSON.stringify(logEntry, null, 2));
  }
  
  private static getLogLevel(code: MCPErrorCode | number): 'debug' | 'info' | 'warn' | 'error' {
    if (code >= -32000 && code <= -32099) return 'error';
    if (code >= -32700 && code <= -32600) return 'error';
    if (code >= -32050 && code <= -32054) return 'warn';
    return 'warn';
  }
}

export class ComplianceValidator {
  static validateErrorResponse(error: any): {
    isValid: boolean;
    errors: string[];
    score: number;
  } {
    const errors: string[] = [];
    let score = 0;
    // Check for required fields
    if (error.error) {
      score += 10;
    } else {
      errors.push('Missing error field');
    }

    if (error.error_code !== undefined) {
      score += 10;
    } else {
      errors.push('Missing error_code field');
    }

    if (error.timestamp) {
      score += 5;
    } else {
      errors.push('Missing timestamp field');
    }

    // Check for proper error code format
    if (error.error_code && typeof error.error_code === 'number' && error.error_code < 0) {
      score += 15;
    } else {
      errors.push('Invalid error_code format (should be negative number)');
    }

    // Check for structured error data
    if (error.data && error.data.type) {
      score += 20;
    } else {
      errors.push('Missing structured error data');
    }

    // Check for server information
    if (error.data && error.data.server) {
      score += 10;
    } else {
      errors.push('Missing server information');
    }

    // Check for request ID
    if (error.request_id || (error.data && error.data.requestId)) {
      score += 10;
    } else {
      errors.push('Missing request ID');
    }

    // Check for proper timestamp format
    if (error.timestamp && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(error.timestamp)) {
      score += 10;
    } else {
      errors.push('Invalid timestamp format (should be ISO 8601)');
    }

    // Check for error description
    if (error.error_description || error.message) {
      score += 10;
    } else {
      errors.push('Missing error description');
    }

    return {
      isValid: errors.length === 0,
      errors,
      score
    };
  }

  static calculateComplianceScore(responses: any[]): {
    overallScore: number;
    details: {
      httpErrors: number;
      jsonRpcErrors: number;
      authenticationErrors: number;
      bankingErrors: number;
    };
    recommendations: string[];
  } {
    let totalScore = 0;
    let httpErrors = 0;
    let jsonRpcErrors = 0;
    let authenticationErrors = 0;
    let bankingErrors = 0;

    responses.forEach(response => {
      const validation = this.validateErrorResponse(response);
      totalScore += validation.score;

      // Categorize errors
      if (response.data) {
        switch (response.data.type) {
          case 'http':
            httpErrors++;
            break;
          case 'json_rpc':
            jsonRpcErrors++;
            break;
          case 'authentication':
            authenticationErrors++;
            break;
          case 'banking':
            bankingErrors++;
            break;
        }
      }
    });

    const overallScore = responses.length > 0 ? Math.round(totalScore / responses.length) : 0;
    const recommendations: string[] = [];

    if (overallScore < 95) {
      recommendations.push('Implement missing error response fields to achieve 95%+ compliance');
    }

    if (httpErrors === 0) {
      recommendations.push('Add HTTP error response tests');
    }

    if (jsonRpcErrors === 0) {
      recommendations.push('Add JSON-RPC error response tests');
    }

    if (authenticationErrors === 0) {
      recommendations.push('Add authentication error response tests');
    }

    return {
      overallScore,
      details: {
        httpErrors,
        jsonRpcErrors,
        authenticationErrors,
        bankingErrors
      },
      recommendations
    };
  }
}
