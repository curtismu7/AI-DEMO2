/**
 * 100% PingOne Naming Convention Validation Suite
 * Comprehensive validation system for ensuring 100% standardization compliance
 * 
 * Phase 69.1: 100% Standardization Implementation
 * Validates all naming conventions across environment variables, applications, resources, and scopes
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 100% Standardization Validation Rules
 */
const STANDARDIZATION_RULES = {
  // Environment variable naming rules
  environmentVariables: {
    pattern: /^PINGONE_[A-Z_]+$/,
    description: 'All PingOne environment variables must use PINGONE_ prefix and uppercase',
    requiredPrefix: 'PINGONE_',
    exceptions: [
      'SESSION_SECRET',
      'NODE_ENV',
      'PORT',
      'DEBUG_OAUTH',
      'DEBUG_TOKENS',
      'DEBUG_SCOPES',
      'SKIP_TOKEN_SIGNATURE_VALIDATION',
      'STRICT_SCOPE_VALIDATION',
      'SCOPE_VALIDATION_TIMEOUT',
      'CACHE_TOKEN_VALIDATION',
      'TOKEN_CACHE_TTL',
      'JWKS_REQUESTS_PER_MINUTE',
      'JWKS_CACHE_MAX_AGE',
      'STEP_UP_AMOUNT_THRESHOLD',
      'STEP_UP_ACR_VALUE',
      'CIBA_ENABLED',
      'CIBA_TOKEN_DELIVERY_MODE',
      'CIBA_BINDING_MESSAGE',
      'CIBA_POLL_INTERVAL_MS',
      'CIBA_AUTH_REQUEST_EXPIRY',
      'FF_TWO_EXCHANGE_DELEGATION',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
      'REDIS_URL',
      'KV_URL',
      'REACT_APP_CLIENT_URL',
      'FRONTEND_ADMIN_URL',
      'FRONTEND_DASHBOARD_URL',
      'PUBLIC_APP_URL',
      'ADMIN_ROLE',
      'USER_ROLE',
      'DEFAULT_USER_TYPE',
      'MCP_SERVER_URL',
      'USE_AGENT_ACTOR_FOR_MCP'
    ]
  },

  // Application naming rules
  applicationNames: {
    pattern: /^[A-Z][a-zA-Z0-9\s]+(App|Service)\sProduction$/,
    description: 'Application names must follow pattern: <Product> <Purpose> <Type> Production',
    examples: [
      'Banking Demo Admin App Production',
      'Banking Demo User App Production',
      'Banking Demo Agent Service Production',
      'Banking Demo AI Agent Service Production'
    ]
  },

  // Resource URI naming rules — plain audience strings (not URLs)
  resourceUris: {
    pattern: /^[a-z][a-z0-9-]*\.ping\.demo$/,
    description: 'Resource audiences must use plain ping.demo string format (no https://)',
    examples: [
      'mcpserver.ping.demo',
      'agentgateway.ping.demo',
      'mcpgateway.ping.demo',
      'enduser.ping.demo'
    ]
  },

  // Scope naming rules — canonical Phase 146 flat names (D-02)
  scopes: {
    pattern: /^(banking:(read|write|admin|sensitive|ai:agent|mcp:invoke)|ai_agent|openid|profile|email|offline_access)$/,
    description: 'Scopes must be canonical Phase 146 names: read, write, admin:read, sensitive:read, ai:agent:read, mcp:invoke, or OIDC built-ins',
    examples: [
      'read',
      'write',
      'admin:read',
      'sensitive:read',
      'ai:agent:read',
      'mcp:invoke'
    ]
  }
};

/**
 * 100% Standardization Validator
 */
class StandardizationValidator {
  constructor() {
    this.rules = STANDARDIZATION_RULES;
    this.issues = [];
    this.warnings = [];
    this.complianceScore = 0;
  }

  /**
   * Perform comprehensive 100% standardization validation
   */
  async validate100Standardization() {
    console.log('Starting 100% PingOne naming convention validation...');
    
    const results = {
      environmentVariables: await this.validateEnvironmentVariables(),
      applicationNames: await this.validateApplicationNames(),
      resourceUris: await this.validateResourceUris(),
      scopes: await this.validateScopes(),
      configurationFiles: await this.validateConfigurationFiles(),
      documentation: await this.validateDocumentation()
    };

    // Calculate overall compliance score
    this.complianceScore = this.calculateComplianceScore(results);
    
    return {
      overall: this.complianceScore >= 100 ? 'fully_compliant' : 'non_compliant',
      score: this.complianceScore,
      maxScore: 100,
      results,
      issues: this.issues,
      warnings: this.warnings,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Validate environment variable naming
   */
  async validateEnvironmentVariables() {
    const result = {
      category: 'environmentVariables',
      score: 0,
      maxScore: 30,
      issues: [],
      warnings: []
    };

    // Load .env.example file
    const envExamplePath = path.join(__dirname, '..', '..', '.env.example');
    if (!fs.existsSync(envExamplePath)) {
      result.issues.push({
        type: 'missing_file',
        file: '.env.example',
        message: '.env.example file not found',
        severity: 'critical'
      });
      return result;
    }

    const envContent = fs.readFileSync(envExamplePath, 'utf8');
    const envLines = envContent.split('\n');
    
    let compliantVars = 0;
    let totalVars = 0;

    for (const line of envLines) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        const varName = match[1];
        totalVars++;

        // Check if it's a PingOne-related variable
        if (this.isPingOneVariable(varName)) {
          if (this.rules.environmentVariables.pattern.test(varName)) {
            compliantVars++;
          } else {
            result.issues.push({
              type: 'environment_variable',
              variable: varName,
              message: 'Environment variable does not follow PINGONE_ naming convention',
              suggestion: this.suggestEnvironmentVariableName(varName),
              severity: 'critical'
            });
          }
        } else if (!this.rules.environmentVariables.exceptions.includes(varName)) {
          result.warnings.push({
            type: 'environment_variable',
            variable: varName,
            message: 'Non-PingOne variable should consider PINGONE_ prefix for consistency',
            suggestion: `PINGONE_${varName}`,
            severity: 'warning'
          });
        }
      }
    }

    result.score = totalVars > 0 ? Math.round((compliantVars / totalVars) * 30) : 0;
    result.summary = `${compliantVars}/${totalVars} PingOne environment variables compliant`;

    return result;
  }

  /**
   * Validate application naming
   */
  async validateApplicationNames() {
    const result = {
      category: 'applicationNames',
      score: 0,
      maxScore: 25,
      issues: [],
      warnings: []
    };

    // Check configuration files for application names
    const configFiles = [
      'services/configStore.js',
      'config/oauth.js'
    ];

    let compliantApps = 0;
    let totalApps = 0;

    for (const configFile of configFiles) {
      const configPath = path.join(__dirname, '..', configFile);
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        
        // Look for application name patterns
        const appMatches = content.match(/name\s*:\s*['"`]([^'"`]+)['"`]/g);
        if (appMatches) {
          for (const match of appMatches) {
            const appName = match.match(/['"`]([^'"`]+)['"`]/)[1];
            totalApps++;

            if (this.rules.applicationNames.pattern.test(appName)) {
              compliantApps++;
            } else {
              result.issues.push({
                type: 'application_name',
                name: appName,
                file: configFile,
                message: 'Application name does not follow standard naming convention',
                suggestion: this.suggestApplicationName(appName),
                severity: 'critical'
              });
            }
          }
        }
      }
    }

    result.score = totalApps > 0 ? Math.round((compliantApps / totalApps) * 25) : 0;
    result.summary = `${compliantApps}/${totalApps} application names compliant`;

    return result;
  }

  /**
   * Validate resource URI naming
   */
  async validateResourceUris() {
    const result = {
      category: 'resourceUris',
      score: 0,
      maxScore: 25,
      issues: [],
      warnings: []
    };

    // Check configuration files for resource URIs
    const configFiles = [
      '.env.example',
      'services/configStore.js'
    ];

    let compliantUris = 0;
    let totalUris = 0;

    for (const configFile of configFiles) {
      const configPath = path.join(__dirname, '..', configFile);
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        
        // Look for URI patterns
        const uriMatches = content.match(/https?:\/\/[^\s"'`]+/g);
        if (uriMatches) {
          for (const uri of uriMatches) {
            if (uri.includes('pingdemo.com') || uri.includes('banking')) {
              totalUris++;

              if (this.rules.resourceUris.pattern.test(uri)) {
                compliantUris++;
              } else {
                result.issues.push({
                  type: 'resource_uri',
                  uri: uri,
                  file: configFile,
                  message: 'Resource URI does not follow standard naming convention',
                  suggestion: this.suggestResourceUri(uri),
                  severity: 'critical'
                });
              }
            }
          }
        }
      }
    }

    result.score = totalUris > 0 ? Math.round((compliantUris / totalUris) * 25) : 0;
    result.summary = `${compliantUris}/${totalUris} resource URIs compliant`;

    return result;
  }

  /**
   * Validate scope naming
   */
  async validateScopes() {
    const result = {
      category: 'scopes',
      score: 0,
      maxScore: 20,
      issues: [],
      warnings: []
    };

    // Check scopes configuration file
    const scopesPath = path.join(__dirname, '..', '..', 'config', 'scopes.js');
    if (!fs.existsSync(scopesPath)) {
      result.issues.push({
        type: 'missing_file',
        file: 'config/scopes.js',
        message: 'Scopes configuration file not found',
        severity: 'critical'
      });
      return result;
    }

    const content = fs.readFileSync(scopesPath, 'utf8');
    
    // Look for scope patterns in BANKING_SCOPES object only
    const scopeMatches = content.match(/BANKING_SCOPES\s*=\s*\{[\s\S]*?\}/);
    if (scopeMatches) {
      const scopesSection = scopeMatches[0];
      // Extract scope values from the BANKING_SCOPES object
      const scopeValueMatches = scopesSection.match(/'([^']+)'/g);
      if (scopeValueMatches) {
        let compliantScopes = 0;
        let totalScopes = 0;

        for (const match of scopeValueMatches) {
          const scope = match.replace(/['"]/g, '');
          if (scope.includes(':')) {
            totalScopes++;

            if (this.rules.scopes.pattern.test(scope)) {
              compliantScopes++;
            } else {
              result.issues.push({
                type: 'scope',
                scope: scope,
                message: 'Scope does not follow standard naming convention',
                suggestion: this.suggestScope(scope),
                severity: 'critical'
              });
            }
          }
        }

        result.score = totalScopes > 0 ? Math.round((compliantScopes / totalScopes) * 20) : 0;
        result.summary = `${compliantScopes}/${totalScopes} scopes compliant`;
      }
    }

    return result;
  }

  /**
   * Validate configuration files for consistency
   */
  async validateConfigurationFiles() {
    const result = {
      category: 'configurationFiles',
      score: 0,
      maxScore: 15,
      issues: [],
      warnings: []
    };

    const configFiles = [
      '.env.example',
      'services/configStore.js',
      'config/scopes.js',
      'config/oauth.js'
    ];

    let compliantFiles = 0;

    for (const configFile of configFiles) {
      const configPath = path.join(__dirname, '..', '..', configFile);
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf8');
        
        // Check for old naming patterns
        const oldPatterns = [
          /AGENT_OAUTH_CLIENT_ID/g,
          /AI_AGENT_CLIENT_ID/g,
          /ENDUSER_AUDIENCE/g,
          /AI_AGENT_AUDIENCE/g,
          /MCP_RESOURCE_URI/g,
          /AGENT_GATEWAY_AUDIENCE/g,
          /MCP_GATEWAY_AUDIENCE/g
        ];

        let hasOldPatterns = false;
        for (const pattern of oldPatterns) {
          if (pattern.test(content)) {
            hasOldPatterns = true;
            result.issues.push({
              type: 'old_naming_pattern',
              file: configFile,
              pattern: pattern.source,
              message: 'Configuration file contains old naming patterns',
              severity: 'critical'
            });
          }
        }

        if (!hasOldPatterns) {
          compliantFiles++;
        }
      } else {
        result.warnings.push({
          type: 'missing_file',
          file: configFile,
          message: 'Configuration file not found',
          severity: 'warning'
        });
      }
    }

    result.score = Math.round((compliantFiles / configFiles.length) * 15);
    result.summary = `${compliantFiles}/${configFiles.length} configuration files compliant`;

    return result;
  }

  /**
   * Validate documentation for consistency
   */
  async validateDocumentation() {
    const result = {
      category: 'documentation',
      score: 0,
      maxScore: 10,
      issues: [],
      warnings: []
    };

    const docsPath = path.join(__dirname, '..', '..', 'docs');
    if (!fs.existsSync(docsPath)) {
      result.warnings.push({
        type: 'missing_directory',
        directory: 'docs',
        message: 'Documentation directory not found',
        severity: 'warning'
      });
      return result;
    }

    // Check for standardization documentation
    const standardizationDoc = path.join(docsPath, 'PINGONE_NAMING_STANDARDIZATION_AUDIT.md');
    if (fs.existsSync(standardizationDoc)) {
      result.score = 10;
      result.summary = 'Standardization documentation found and compliant';
    } else {
      result.issues.push({
        type: 'missing_documentation',
        file: 'PINGONE_NAMING_STANDARDIZATION_AUDIT.md',
        message: 'Standardization documentation not found',
        severity: 'warning'
      });
      result.score = 5;
    }

    return result;
  }

  /**
   * Helper methods
   */
  isPingOneVariable(varName) {
    const pingOneKeywords = [
      'PINGONE', 'CLIENT_ID', 'CLIENT_SECRET', 'AGENT', 'AI_AGENT', 
      'ENDUSER', 'AUDIENCE', 'MCP', 'RESOURCE', 'GATEWAY'
    ];
    
    return pingOneKeywords.some(keyword => varName.includes(keyword));
  }

  suggestEnvironmentVariableName(currentName) {
    const suggestions = {
      'AGENT_OAUTH_CLIENT_ID': 'PINGONE_AGENT_CLIENT_ID',
      'AGENT_OAUTH_CLIENT_SECRET': 'PINGONE_AGENT_CLIENT_SECRET',
      'AI_AGENT_CLIENT_ID': 'PINGONE_AI_AGENT_CLIENT_ID',
      'AI_AGENT_CLIENT_SECRET': 'PINGONE_AI_AGENT_CLIENT_SECRET',
      'ENDUSER_AUDIENCE': 'PINGONE_AUDIENCE_ENDUSER',
      'AI_AGENT_AUDIENCE': 'PINGONE_AUDIENCE_AI_AGENT',
      'AI_AGENT_SCOPE': 'PINGONE_SCOPE_AI_AGENT',
      'MCP_RESOURCE_URI': 'PINGONE_RESOURCE_MCP_SERVER_URI',
      'MCP_RESOURCE_URI_TWO_EXCHANGE': 'PINGONE_RESOURCE_TWO_EXCHANGE_URI',
      'AGENT_GATEWAY_AUDIENCE': 'PINGONE_RESOURCE_AGENT_GATEWAY_URI',
      'MCP_GATEWAY_AUDIENCE': 'PINGONE_RESOURCE_MCP_GATEWAY_URI'
    };

    return suggestions[currentName] || `PINGONE_${currentName}`;
  }

  suggestApplicationName(currentName) {
    if (currentName.toLowerCase().includes('admin')) {
      return 'Banking Demo Admin App Production';
    } else if (currentName.toLowerCase().includes('user')) {
      return 'Banking Demo User App Production';
    } else if (currentName.toLowerCase().includes('agent')) {
      return currentName.toLowerCase().includes('ai') 
        ? 'Banking Demo AI Agent Service Production'
        : 'Banking Demo Agent Service Production';
    }
    
    return 'Banking Demo Application Production';
  }

  suggestResourceUri(currentUri) {
    if (currentUri.includes('mcp-server') || currentUri.includes('ai-agent')) {
      return 'mcpserver.ping.demo';
    } else if (currentUri.includes('resource-server')) {
      return 'mcpserver.ping.demo';
    } else if (currentUri.includes('agent-gateway')) {
      return 'agentgateway.ping.demo';
    } else if (currentUri.includes('mcp-gateway')) {
      return 'mcpgateway.ping.demo';
    } else if (currentUri.includes('api')) {
      return 'enduser.ping.demo';
    }
    
    return 'enduser.ping.demo';
  }

  suggestScope(currentScope) {
    // Map stale scope names to canonical Phase 146 equivalents
    const canonicalMap = {
      'ai_agent': 'ai:agent:read',
      'admin:read:full': 'admin:read',
      'admin:read:users': 'admin:read',
      'admin:read:audit': 'admin:read',
      'accounts:read': 'read',
      'write': 'write',
      'transactions:read': 'read',
      'transactions:write': 'write',
      'ai:agent:read': 'ai:agent:read',
      'agent:invoke': 'ai:agent:read',
      'sensitive:read': 'sensitive:read',
      'mcp:invoke': 'mcp:invoke',
    };
    if (canonicalMap[currentScope]) return canonicalMap[currentScope];
    if (['read','write','admin:read','sensitive:read','ai:agent:read','mcp:invoke'].includes(currentScope)) {
      return currentScope; // Already canonical
    }
    return 'read'; // Safe fallback
  }

  calculateComplianceScore(results) {
    let totalScore = 0;
    let maxScore = 0;

    for (const [category, result] of Object.entries(results)) {
      totalScore += result.score || 0;
      maxScore += result.maxScore || 0;
    }

    return maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  }
}

/**
 * Run 100% standardization validation
 */
async function run100StandardizationValidation() {
  const validator = new StandardizationValidator();
  const results = await validator.validate100Standardization();

  console.log('\n=== 100% PINGONE NAMING CONVENTION VALIDATION RESULTS ===');
  console.log(`Overall Score: ${results.score}/${results.maxScore} (${results.overall})`);
  console.log(`Timestamp: ${results.timestamp}`);
  
  console.log('\n--- Category Results ---');
  for (const [category, result] of Object.entries(results.results)) {
    console.log(`${category}: ${result.score}/${result.maxScore} - ${result.summary}`);
    
    if (result.issues.length > 0) {
      console.log(`  Issues (${result.issues.length}):`);
      result.issues.forEach(issue => {
        console.log(`    - ${issue.message} (${issue.severity})`);
        if (issue.suggestion) {
          console.log(`      Suggestion: ${issue.suggestion}`);
        }
      });
    }
    
    if (result.warnings.length > 0) {
      console.log(`  Warnings (${result.warnings.length}):`);
      result.warnings.forEach(warning => {
        console.log(`    - ${warning.message} (${warning.severity})`);
      });
    }
  }

  if (results.overall === 'fully_compliant') {
    console.log('\n\u2705 100% STANDARDIZATION ACHIEVED! All naming conventions are fully compliant.');
  } else {
    console.log(`\n\u274c Standardization incomplete. Score: ${results.score}/100`);
    console.log('Please address the issues above to achieve 100% standardization.');
  }

  return results;
}

// Export for use in tests and other modules
module.exports = {
  StandardizationValidator,
  STANDARDIZATION_RULES,
  run100StandardizationValidation
};

describe('StandardizationValidator', () => {
  test('should export validator class and rules', () => {
    expect(StandardizationValidator).toBeDefined();
    expect(STANDARDIZATION_RULES).toBeDefined();
    expect(typeof run100StandardizationValidation).toBe('function');
  });

  test('should create validator instance', () => {
    const validator = new StandardizationValidator();
    expect(validator).toBeDefined();
    expect(validator.rules).toBeDefined();
  });
});
