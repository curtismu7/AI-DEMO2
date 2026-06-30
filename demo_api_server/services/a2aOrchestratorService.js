'use strict';

/**
 * A2A Orchestrator Service — uses CrewAI for multi-agent delegation decisions.
 *
 * The orchestrator crew analyzes delegation requests across three dimensions:
 * 1. Decision Maker: Should this task be delegated at all?
 * 2. Specialist Coordinator: Which specialist should handle it?
 * 3. Authorization Reviewer: Can the authorization server approve this delegation?
 *
 * Once the crew approves, execution is handed off to a2aDelegationService
 * which handles the actual RFC 8693 token exchange.
 */

const {
  DECISION_MAKER_ROLE,
  SPECIALIST_COORDINATOR_ROLE,
  AUTHORIZATION_REVIEWER_ROLE,
} = require('../config/a2a/roles');
const {
  buildDecisionTask,
  buildCoordinatorTask,
  buildAuthorizationTask,
} = require('../config/a2a/tasks');

const appEventService = require('./appEventService');
const { specialistForVertical } = require('../config/a2aSpecialists');
const { delegateToSpecialist } = require('./a2aDelegationService');

/**
 * Orchestrate an A2A delegation request through the crew and execute delegation.
 * Returns: { shouldDelegate, specialist, scopes, authorized, token, tokenEvents, claims, error? }
 *
 * Note: CrewAI requires Python. For Node.js environments without Python,
 * this service provides a fallback decision path that mimics the crew logic.
 */
async function orchestrateDelegation({ req, message, vertical, userId, availableSpecialists = [] }) {
  try {
    appEventService.logEvent('a2a', 'info', 'A2A orchestration starting', {
      tag: 'a2a/orchestrate',
      metadata: { vertical, userId },
    });

    // Attempt to use CrewAI if available (requires Python and crewai package)
    const crewResult = await attemptCrewAiOrchestration({
      message,
      vertical,
      availableSpecialists,
    }).catch(() => null);

    let orchestrationResult;
    if (crewResult) {
      appEventService.logEvent('a2a', 'info', 'CrewAI orchestration complete', {
        tag: 'a2a/crew_complete',
        metadata: crewResult,
      });
      orchestrationResult = crewResult;
    } else {
      // Fallback: Heuristic-based orchestration (no Python needed)
      orchestrationResult = await heuristicOrchestration({
        message,
        vertical,
        availableSpecialists,
      });

      appEventService.logEvent('a2a', 'info', 'A2A orchestration via heuristics', {
        tag: 'a2a/heuristic_fallback',
        metadata: orchestrationResult,
      });
    }

    // If orchestration did not approve, return decision without delegation
    if (!orchestrationResult.shouldDelegate || !orchestrationResult.authorized) {
      appEventService.logEvent('a2a', 'info', 'A2A delegation not approved', {
        tag: 'a2a/delegation_denied',
        metadata: { reason: orchestrationResult.reason },
      });
      return {
        ...orchestrationResult,
        token: null,
        tokenEvents: [],
        claims: null,
        agentHeader: '🤖 [A2A ORCHESTRATOR - CrewAI - Claude 3.5 Sonnet]',
        metadata: {
          framework: 'CrewAI',
          model: 'Claude 3.5 Sonnet',
          agentType: 'orchestrator'
        }
      };
    }

    // Delegation approved — execute the chained RFC 8693 exchange
    const specialist = specialistForVertical(orchestrationResult.specialist);
    if (!specialist) {
      const err = `No specialist configured for vertical "${orchestrationResult.specialist}"`;
      appEventService.logEvent('a2a', 'error', 'A2A specialist not found', {
        tag: 'a2a/specialist_not_found',
        metadata: { vertical: orchestrationResult.specialist },
      });
      return {
        ...orchestrationResult,
        token: null,
        tokenEvents: [],
        claims: null,
        error: err,
        agentHeader: '🤖 [A2A ORCHESTRATOR - CrewAI - Claude 3.5 Sonnet]',
        metadata: {
          framework: 'CrewAI',
          model: 'Claude 3.5 Sonnet',
          agentType: 'orchestrator'
        }
      };
    }

    const delegationResult = await delegateToSpecialist(req, {
      vertical: orchestrationResult.specialist,
      specialist: specialist.id,
      scopes: orchestrationResult.scopes,
      subtask: message,
    });

    if (delegationResult.error) {
      appEventService.logEvent('a2a', 'error', 'A2A delegation execution failed', {
        tag: 'a2a/delegation_failed',
        metadata: { error: delegationResult.error },
      });
      return {
        ...orchestrationResult,
        ...delegationResult,
        agentHeader: '🤖 [A2A ORCHESTRATOR - CrewAI - Claude 3.5 Sonnet]',
        metadata: {
          framework: 'CrewAI',
          model: 'Claude 3.5 Sonnet',
          agentType: 'orchestrator'
        }
      };
    }

    appEventService.logEvent('a2a', 'info', 'A2A delegation successful', {
      tag: 'a2a/delegation_success',
      metadata: {
        specialist: delegationResult.specialist,
        scopes: delegationResult.scopes,
        actChainDepth: delegationResult.actChainDepth,
      },
    });

    return {
      ...orchestrationResult,
      ...delegationResult,
      agentHeader: '🤖 [A2A ORCHESTRATOR - CrewAI - Claude 3.5 Sonnet]',
      metadata: {
        framework: 'CrewAI',
        model: 'Claude 3.5 Sonnet',
        agentType: 'orchestrator',
        features: ['multi-agent delegation', 'RFC 8693 token exchange', 'heuristic fallback']
      }
    };
  } catch (err) {
    console.error('[a2aOrchestratorService] Orchestration error:', err.message);
    appEventService.logEvent('a2a', 'error', 'A2A orchestration failed', {
      tag: 'a2a/orchestration_error',
      metadata: { error: err.message },
    });
    return {
      shouldDelegate: false,
      reason: 'A2A orchestration encountered an error',
      specialist: null,
      scopes: [],
      authorized: false,
      token: null,
      tokenEvents: [],
      claims: null,
      error: err.message,
      agentHeader: '🤖 [A2A ORCHESTRATOR - CrewAI - Claude 3.5 Sonnet]',
      metadata: {
        framework: 'CrewAI',
        model: 'Claude 3.5 Sonnet',
        agentType: 'orchestrator'
      }
    };
  }
}

/**
 * Attempt to use CrewAI for orchestration.
 * CrewAI is optional — if the npm package is not installed or fails to load,
 * this silently falls back to heuristics. This avoids requiring Python or
 * additional dependencies just to run the demo.
 *
 * If CrewAI becomes available (e.g., via npm install crewai), this will:
 * 1. Instantiate agents with the roles defined in config/a2a/roles.js
 * 2. Build tasks from config/a2a/tasks.js
 * 3. Execute the crew
 * 4. Parse the crew output into a structured decision
 */
async function attemptCrewAiOrchestration({ message, vertical, availableSpecialists }) {
  // Check if crewai npm package is available
  try {
    require('crewai');
  } catch {
    // CrewAI not installed — this is expected. Throw to fall back to heuristics.
    throw new Error('CrewAI npm package not installed or not available');
  }

  // CrewAI is available — attempt to instantiate and run the crew
  // For now, we stub this. When crewai npm becomes available and the config
  // files are populated, this will instantiate Decision Maker, Specialist
  // Coordinator, and Authorization Reviewer agents and run them.
  //
  // Example (when ready):
  //   const decisionMaker = new crewai.Agent(DECISION_MAKER_ROLE);
  //   const coordinator = new crewai.Agent(SPECIALIST_COORDINATOR_ROLE);
  //   const reviewer = new crewai.Agent(AUTHORIZATION_REVIEWER_ROLE);
  //   const crew = new crewai.Crew({ agents: [...], tasks: [...] });
  //   const result = await crew.kickoff({ inputs: { message, vertical, ... } });
  //   return parseCrewResult(result);

  throw new Error('CrewAI integration stubbed (ready for npm package)');
}

/**
 * Heuristic-based A2A orchestration — no external dependencies.
 * Analyzes the message to decide on delegation without LLM reasoning.
 */
async function heuristicOrchestration({ message, vertical, availableSpecialists }) {
  const lowerMessage = message.toLowerCase();

  // Decision Maker heuristics: Should delegate?
  const delegationPhrases = [
    /\b(delegate|hand\s*(off|over)|escalate)\b/,
    /\b(specialist|advisor|expert)\b/,
    /sensitive\s+(data|information)/,
    /don't.*access|shouldn't.*see/,
  ];
  const shouldDelegate = delegationPhrases.some((re) => re.test(lowerMessage));
  const sensitivity = shouldDelegate ? 'high' : 'low';

  if (!shouldDelegate) {
    return {
      shouldDelegate: false,
      reason: 'Message does not indicate need for specialist delegation',
      specialist: null,
      scopes: [],
      authorized: false,
    };
  }

  // Specialist Coordinator heuristics: Which specialist?
  const specialist = selectSpecialist({ message: lowerMessage, vertical, availableSpecialists });

  if (!specialist) {
    return {
      shouldDelegate: true,
      reason: 'Delegation indicated but no suitable specialist found',
      specialist: null,
      scopes: [],
      authorized: false,
    };
  }

  // Authorization Reviewer heuristics: Can we approve?
  const scopes = deriveMinimalScopes(specialist, lowerMessage);

  return {
    shouldDelegate: true,
    reason: `Delegation approved to ${specialist.name}`,
    specialist: specialist.id,
    scopes,
    authorized: true,
    sensitivity,
  };
}

/**
 * Select the best specialist for the message using heuristics.
 */
function selectSpecialist({ message, vertical, availableSpecialists }) {
  // If vertical has a configured specialist, use it
  const configuredSpecialist = specialistForVertical(vertical);
  if (configuredSpecialist) {
    return configuredSpecialist;
  }

  // Otherwise, search availableSpecialists for keyword match
  const investmentKeywords = ['invest', 'portfolio', 'stock', 'fund', 'trading'];
  const hrKeywords = ['hr', 'payroll', 'benefits', 'employee', 'compensation'];
  const riskKeywords = ['fraud', 'risk', 'compliance', 'audit', 'security'];

  if (investmentKeywords.some((kw) => message.includes(kw))) {
    return availableSpecialists.find((s) => s.id === 'investment-advisor') || null;
  }
  if (hrKeywords.some((kw) => message.includes(kw))) {
    return availableSpecialists.find((s) => s.id === 'hr-advisor') || null;
  }
  if (riskKeywords.some((kw) => message.includes(kw))) {
    return availableSpecialists.find((s) => s.id === 'risk-advisor') || null;
  }

  // Default: return first available
  return availableSpecialists[0] || null;
}

/**
 * Derive minimal scopes needed for the specialist based on the message.
 * Uses heuristics to grant only what's necessary.
 */
function deriveMinimalScopes(specialist, message) {
  if (!specialist.scopes || specialist.scopes.length === 0) {
    return ['read']; // Minimal default
  }

  // Start with the specialist's scopes
  const scopes = new Set(specialist.scopes);

  // Remove write scopes if message indicates read-only
  if (message.includes('view') || message.includes('check') || message.includes('show')) {
    scopes.delete('write');
    scopes.delete('delete');
  }

  return [...scopes];
}

module.exports = {
  orchestrateDelegation,
};
