/**
 * Delegation Chain Validation Service
 * Comprehensive validation of complete delegation chain integrity
 * 
 * Phase 58-04: Delegation Chain Validation
 * Provides chain validation, circular detection, and audit logging
 */

'use strict';

const { writeExchangeEvent } = require('./exchangeAuditStore');
const scopeTopology = require('./scopeTopology');

// Canonical PingOne audiences (single source of truth: scope-topology.json).
const AUDIENCES = scopeTopology.audiences();

/**
 * Delegation chain validation rules and thresholds
 */
const CHAIN_VALIDATION_RULES = {
  // Expected chain length for different delegation patterns
  expected_lengths: {
    single_exchange: 3, // user -> agent -> mcp_server
    double_exchange: 4, // user -> agent -> intermediate -> mcp_server
    subject_only: 2     // user -> mcp_server (no agent)
  },
  
  // Maximum allowed chain length
  max_chain_length: 5,
  
  // Chain integrity checks
  integrity_checks: {
    subject_preservation: true,
    agent_authorization: true,
    mcp_server_identity: true,
    circular_detection: true,
    identifier_format: true
  },
  
  // Validation timeouts
  timeouts: {
    chain_reconstruction: 5000, // 5 seconds
    circular_detection: 1000,    // 1 second
    integrity_validation: 3000   // 3 seconds
  }
};

/**
 * Delegation chain node structure
 */
class ChainNode {
  constructor(type, sub, metadata = {}) {
    this.type = type;           // 'user', 'agent', 'mcp_server', 'intermediate'
    this.sub = sub;             // Subject identifier
    this.timestamp = metadata.timestamp || new Date().toISOString();
    this.may_act = metadata.may_act || null;
    this.act = metadata.act || null;
    this.audience = metadata.audience || null;
    this.scopes = metadata.scopes || [];
    this.metadata = metadata;
  }

  /**
   * Check if this node represents the same entity as another
   */
  equals(other) {
    if (!other) return false;
    return this.type === other.type && this.sub === other.sub;
  }

  /**
   * Get node identifier for comparison
   */
  getIdentifier() {
    return `${this.type}:${this.sub}`;
  }

  /**
   * Convert node to JSON representation
   */
  toJSON() {
    return {
      type: this.type,
      sub: this.sub,
      timestamp: this.timestamp,
      may_act: this.may_act,
      act: this.act,
      audience: this.audience,
      scopes: this.scopes,
      identifier: this.getIdentifier()
    };
  }
}

/**
 * Normalize a delegation-chain subject to the canonical *.ping.demo audience
 * form. The two PingOne-registered audiences are emitted bare:
 *   https://agent-gateway.pingdemo.com/agent/{id} -> agentgateway.ping.demo/agent/{id}
 *   https://mcp-server.pingdemo.com/mcp/{id}       -> mcpserver.ping.demo/mcp/{id}
 * Everything else (e.g. https://banking-agent.pingdemo.com/agent/{id}) is left
 * unchanged. Keeps chain nodes consistent with configStore audiences,
 * scope-topology.json and docs/user-guide/PINGONE_CONFIG.md.
 */
const LEGACY_AGENT_GW_SUB_RE = /^https:\/\/agent-gateway\.pingdemo\.com\/agent\/([a-zA-Z0-9-]+)$/;
const LEGACY_MCP_SERVER_SUB_RE = /^https:\/\/mcp-server\.pingdemo\.com\/mcp\/([a-zA-Z0-9-]+)$/;

function normalizeChainSubject(sub) {
  if (typeof sub !== 'string') return sub;
  const agentGw = sub.match(LEGACY_AGENT_GW_SUB_RE);
  if (agentGw) return `${AUDIENCES.agentGateway}/agent/${agentGw[1]}`;
  const mcpSrv = sub.match(LEGACY_MCP_SERVER_SUB_RE);
  if (mcpSrv) return `${AUDIENCES.mcpServer}/mcp/${mcpSrv[1]}`;
  return sub;
}

/**
 * Delegation Chain Validation Service
 */
class DelegationChainValidationService {
  constructor(options = {}) {
    this.rules = { ...CHAIN_VALIDATION_RULES, ...options };
    this.validationCache = new Map();
  }

  /**
   * Validate complete delegation chain integrity
   */
  async validateDelegationChain(userToken, exchangedToken, options = {}) {
    const {
      chainType = 'single_exchange',
      strict = true,
      cacheKey = null
    } = options;

    const validation = {
      valid: true,
      errors: [],
      warnings: [],
      chain: null,
      metadata: {
        chainType,
        expectedLength: this.rules.expected_lengths[chainType],
        validationTimestamp: new Date().toISOString()
      }
    };

    try {
      // Check cache first
      if (cacheKey && this.validationCache.has(cacheKey)) {
        const cached = this.validationCache.get(cacheKey);
        if (cached.timestamp > Date.now() - 300000) { // 5 minute cache
          return { ...cached, fromCache: true };
        }
      }

      // Reconstruct delegation chain
      const chain = await this.reconstructDelegationChain(userToken, exchangedToken);
      validation.chain = chain;

      // Validate chain structure
      await this.validateChainStructure(chain, validation);

      // Validate chain integrity
      await this.validateChainIntegrity(chain, validation);

      // Validate chain length
      this.validateChainLength(chain, chainType, validation);

      // Detect circular delegation
      await this.detectCircularDelegation(chain, validation);

      // Validate identifier formats
      await this.validateIdentifierFormats(chain, validation);

      // Strict mode checks
      if (strict) {
        this.validateStrictRequirements(chain, validation);
      }

      // Cache results
      if (cacheKey) {
        this.validationCache.set(cacheKey, {
          ...validation,
          timestamp: Date.now()
        });
      }

      // Log validation result
      await this.logValidationResult(validation);

    } catch (error) {
      validation.valid = false;
      validation.errors.push(`Chain validation failed: ${error.message}`);
      
      await this.logValidationError(validation, error);
    }

    return validation;
  }

  /**
   * Reconstruct delegation chain from tokens
   */
  async reconstructDelegationChain(userToken, exchangedToken) {
    const startTime = Date.now();
    
    try {
      // Decode tokens
      const userClaims = this.decodeTokenClaims(userToken);
      const exchangedClaims = this.decodeTokenClaims(exchangedToken);

      // Build chain nodes
      const chain = [];

      // User node
      const userNode = new ChainNode('user', userClaims.sub, {
        timestamp: new Date().toISOString(),
        may_act: userClaims.may_act,
        scopes: this.parseScopes(userClaims.scope)
      });
      chain.push(userNode);

      // Agent node (from may_act)
      if (userClaims.may_act && userClaims.may_act.sub) {
        const agentNode = new ChainNode('agent', normalizeChainSubject(userClaims.may_act.sub), {
          timestamp: new Date().toISOString(),
          source: 'user_token.may_act'
        });
        chain.push(agentNode);
      }

      // Intermediate nodes (from nested act claims)
      if (exchangedClaims.act && exchangedClaims.act.act) {
        const intermediateNode = new ChainNode('intermediate', normalizeChainSubject(exchangedClaims.act.act.sub), {
          timestamp: new Date().toISOString(),
          source: 'exchanged_token.act.act'
        });
        chain.push(intermediateNode);
      }

      // MCP server node (from act claim)
      if (exchangedClaims.act && exchangedClaims.act.sub) {
        const mcpNode = new ChainNode('mcp_server', normalizeChainSubject(exchangedClaims.act.sub), {
          timestamp: new Date().toISOString(),
          audience: exchangedClaims.aud,
          scopes: this.parseScopes(exchangedClaims.scope),
          source: 'exchanged_token.act'
        });
        chain.push(mcpNode);
      }

      // Check timeout
      if (Date.now() - startTime > this.rules.timeouts.chain_reconstruction) {
        throw new Error('Chain reconstruction timeout');
      }

      return chain;

    } catch (error) {
      throw new Error(`Chain reconstruction failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Validate chain structure
   */
  async validateChainStructure(chain, validation) {
    if (!chain || chain.length === 0) {
      validation.valid = false;
      validation.errors.push('Empty delegation chain');
      return;
    }

    // Check for required node types
    const nodeTypes = chain.map(node => node.type);
    const hasUser = nodeTypes.includes('user');
    const hasMcpServer = nodeTypes.includes('mcp_server');

    if (!hasUser) {
      validation.valid = false;
      validation.errors.push('Missing user node in delegation chain');
    }

    if (!hasMcpServer) {
      validation.valid = false;
      validation.errors.push('Missing MCP server node in delegation chain');
    }

    // Check node order
    const userIndex = nodeTypes.indexOf('user');
    const mcpIndex = nodeTypes.indexOf('mcp_server');

    if (userIndex > 0) {
      validation.warnings.push('User node should be first in delegation chain');
    }

    if (mcpIndex < nodeTypes.length - 1) {
      validation.warnings.push('MCP server node should be last in delegation chain');
    }
  }

  /**
   * Validate chain integrity
   */
  async validateChainIntegrity(chain, validation) {
    if (!this.rules.integrity_checks) return;

    const userNode = chain.find(node => node.type === 'user');
    const mcpNode = chain.find(node => node.type === 'mcp_server');
    const agentNode = chain.find(node => node.type === 'agent');

    // Subject preservation check
    if (this.rules.integrity_checks.subject_preservation) {
      const userSubject = userNode?.sub;
      const exchangedSubject = mcpNode?.sub; // This should be the user's sub preserved

      if (userSubject && exchangedSubject && userSubject !== exchangedSubject) {
        validation.valid = false;
        validation.errors.push(`Subject not preserved: expected ${userSubject}, got ${exchangedSubject}`);
      }
    }

    // Agent authorization check
    if (this.rules.integrity_checks.agent_authorization && userNode && agentNode) {
      const authorizedAgent = userNode.may_act?.sub;
      const actualAgent = agentNode.sub;

      if (authorizedAgent && actualAgent && authorizedAgent !== actualAgent) {
        validation.valid = false;
        validation.errors.push(`Agent not authorized: expected ${authorizedAgent}, got ${actualAgent}`);
      }
    }

    // MCP server identity check
    if (this.rules.integrity_checks.mcp_server_identity) {
      const expectedMcpAudience = mcpNode?.audience;
      const actualMcpSub = mcpNode?.sub;

      if (expectedMcpAudience && actualMcpSub && !actualMcpSub.includes(expectedMcpAudience)) {
        validation.warnings.push(`MCP server identity may not match audience: sub=${actualMcpSub}, aud=${expectedMcpAudience}`);
      }
    }
  }

  /**
   * Validate chain length
   */
  validateChainLength(chain, chainType, validation) {
    const actualLength = chain.length;
    const expectedLength = this.rules.expected_lengths[chainType] || 3;
    const maxLength = this.rules.max_chain_length;

    if (actualLength > maxLength) {
      validation.valid = false;
      validation.errors.push(`Chain too long: ${actualLength} > ${maxLength}`);
    }

    if (actualLength !== expectedLength) {
      validation.warnings.push(`Chain length mismatch: expected ${expectedLength}, got ${actualLength}`);
    }
  }

  /**
   * Detect circular delegation
   */
  async detectCircularDelegation(chain, validation) {
    if (!this.rules.integrity_checks.circular_detection) return;

    const startTime = Date.now();
    
    try {
      const subjects = chain.map(node => node.sub);
      const identifiers = chain.map(node => node.getIdentifier());
      
      // Check for duplicate subjects
      const uniqueSubjects = new Set(subjects);
      if (subjects.length !== uniqueSubjects.size) {
        validation.valid = false;
        validation.errors.push('Circular delegation detected: duplicate subjects in chain');
        
        // Find the circular references
        const duplicates = subjects.filter((subject, index) => subjects.indexOf(subject) !== index);
        validation.errors.push(`Circular subjects: ${duplicates.join(', ')}`);
      }

      // Check for duplicate identifiers
      const uniqueIdentifiers = new Set(identifiers);
      if (identifiers.length !== uniqueIdentifiers.size) {
        validation.valid = false;
        validation.errors.push('Circular delegation detected: duplicate identifiers in chain');
        
        // Find the circular references
        const duplicates = identifiers.filter((id, index) => identifiers.indexOf(id) !== index);
        validation.errors.push(`Circular identifiers: ${duplicates.join(', ')}`);
      }

      // Check timeout
      if (Date.now() - startTime > this.rules.timeouts.circular_detection) {
        throw new Error('Circular detection timeout');
      }

    } catch (error) {
      validation.valid = false;
      validation.errors.push(`Circular detection failed: ${error.message}`);
    }
  }

  /**
   * Validate identifier formats
   */
  async validateIdentifierFormats(chain, validation) {
    if (!this.rules.integrity_checks.identifier_format) return;

    for (const node of chain) {
      try {
        // Basic format validation
        if (!node.sub || typeof node.sub !== 'string') {
          validation.warnings.push(`Invalid subject format for ${node.type}: ${node.sub}`);
          continue;
        }

        // Check for URI format in non-user nodes
        if (node.type !== 'user' && !node.sub.startsWith('https://')) {
          validation.warnings.push(`Non-URI format for ${node.type}: ${node.sub}`);
        }

        // Check for proper domain
        if (node.type === 'agent' && node.sub.includes('.pingdemo.com/agent/')) {
          // Valid agent format
        } else if (node.type === 'mcp_server' && node.sub.includes('.pingdemo.com/mcp/')) {
          // Valid MCP server format
        } else if (node.type !== 'user') {
          validation.warnings.push(`Unexpected format for ${node.type}: ${node.sub}`);
        }

      } catch (error) {
        validation.warnings.push(`Identifier format validation failed for ${node.type}: ${error.message}`);
      }
    }
  }

  /**
   * Validate strict requirements
   */
  validateStrictRequirements(chain, validation) {
    // All nodes must have proper timestamps
    const nodesWithoutTimestamp = chain.filter(node => !node.timestamp);
    if (nodesWithoutTimestamp.length > 0) {
      validation.valid = false;
      validation.errors.push(`${nodesWithoutTimestamp.length} nodes missing timestamps`);
    }

    // Chain must have expected node types
    const nodeTypes = chain.map(node => node.type);
    const requiredTypes = ['user', 'agent', 'mcp_server'];
    const missingTypes = requiredTypes.filter(type => !nodeTypes.includes(type));
    
    if (missingTypes.length > 0) {
      validation.valid = false;
      validation.errors.push(`Missing required node types: ${missingTypes.join(', ')}`);
    }

    // All identifiers must be unique
    const identifiers = chain.map(node => node.getIdentifier());
    const uniqueIdentifiers = new Set(identifiers);
    if (identifiers.length !== uniqueIdentifiers.size) {
      validation.valid = false;
      validation.errors.push('Duplicate identifiers in strict mode');
    }
  }

  /**
   * Parse scopes from token claims
   */
  parseScopes(scopeClaim) {
    if (!scopeClaim) return [];
    
    if (typeof scopeClaim === 'string') {
      return scopeClaim.split(' ').filter(Boolean);
    }
    
    if (Array.isArray(scopeClaim)) {
      return scopeClaim;
    }
    
    return [];
  }

  /**
   * Decode JWT claims safely
   */
  decodeTokenClaims(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload;
    } catch (error) {
      throw new Error(`Failed to decode token claims: ${error.message}`, { cause: error });
    }
  }

  /**
   * Generate chain visualization
   */
  generateChainVisualization(chain) {
    if (!chain || chain.length === 0) {
      return 'Empty delegation chain';
    }

    const nodes = chain.map((node, index) => {
      const arrow = index < chain.length - 1 ? ' → ' : '';
      return `${node.type}(${node.sub})${arrow}`;
    });

    return nodes.join(' ');
  }

  /**
   * Get chain statistics
   */
  getChainStatistics(chain) {
    if (!chain || chain.length === 0) {
      return {
        length: 0,
        nodeTypes: {},
        hasCircularDelegation: false,
        subjectPreserved: false
      };
    }

    const nodeTypes = {};
    chain.forEach(node => {
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
    });

    const subjects = chain.map(node => node.sub);
    const uniqueSubjects = new Set(subjects);
    const hasCircularDelegation = subjects.length !== uniqueSubjects.size;

    const userNode = chain.find(node => node.type === 'user');
    const mcpNode = chain.find(node => node.type === 'mcp_server');
    const subjectPreserved = userNode && mcpNode && userNode.sub === mcpNode.sub;

    return {
      length: chain.length,
      nodeTypes,
      hasCircularDelegation,
      subjectPreserved,
      userSubject: userNode?.sub,
      mcpServerSubject: mcpNode?.sub,
      agentSubject: chain.find(node => node.type === 'agent')?.sub
    };
  }

  /**
   * Clear validation cache
   */
  clearCache() {
    this.validationCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics() {
    return {
      size: this.validationCache.size,
      keys: Array.from(this.validationCache.keys())
    };
  }

  /**
   * Log validation result
   */
  async logValidationResult(validation) {
    await writeExchangeEvent({
      type: 'delegation_chain_validation',
      level: validation.valid ? 'info' : 'error',
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      chainLength: validation.chain?.length || 0,
      chainVisualization: validation.chain ? this.generateChainVisualization(validation.chain) : null,
      statistics: validation.chain ? this.getChainStatistics(validation.chain) : null,
      metadata: validation.metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log validation error
   */
  async logValidationError(validation, error) {
    await writeExchangeEvent({
      type: 'delegation_chain_validation_error',
      level: 'error',
      validationErrors: validation.errors,
      errorMessage: error.message,
      errorStack: error.stack,
      metadata: validation.metadata,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  DelegationChainValidationService,
  ChainNode,
  CHAIN_VALIDATION_RULES
};
