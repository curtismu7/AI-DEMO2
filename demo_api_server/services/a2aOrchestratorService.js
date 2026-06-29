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

/**
 * Orchestrate an A2A delegation request through the crew.
 * Returns a decision object: { shouldDelegate, specialist, scopes, authorization }
 *
 * Note: CrewAI requires Python. For Node.js environments without Python,
 * this service provides a fallback decision path that mimics the crew logic.
 */
async function orchestrateDelegation({ message, vertical, userId, availableSpecialists = [] }) {
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

    if (crewResult) {
      appEventService.logEvent('a2a', 'info', 'CrewAI orchestration complete', {
        tag: 'a2a/crew_complete',
        metadata: crewResult,
      });
      return crewResult;
    }

    // Fallback: Heuristic-based orchestration (no Python needed)
    const fallbackResult = await heuristicOrchestration({
      message,
      vertical,
      availableSpecialists,
    });

    appEventService.logEvent('a2a', 'info', 'A2A orchestration via heuristics', {
      tag: 'a2a/heuristic_fallback',
      metadata: fallbackResult,
    });

    return fallbackResult;
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
      error: err.message,
    };
  }
}

/**
 * Attempt to use CrewAI for orchestration.
 * This is a placeholder for when CrewAI (Python) is available.
 * For MVP, this will be stubbed or implemented via a Python subprocess.
 */
async function attemptCrewAiOrchestration({ message, vertical, availableSpecialists }) {
  // TODO: Implement CrewAI integration
  // This would require:
  // 1. crewai npm package or Python subprocess bridge
  // 2. Instantiating agents with the roles defined in config/a2a/roles.js
  // 3. Building and executing tasks from config/a2a/tasks.js
  // 4. Parsing the crew output into a structured decision

  // For now, throw to fall back to heuristics
  throw new Error('CrewAI integration not yet implemented');
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
