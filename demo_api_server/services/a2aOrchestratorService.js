'use strict';

/**
 * A2A Orchestrator Service — LLM-backed multi-stage delegation decisions.
 *
 * Three sequential LLM calls (local llama.cpp proxy, same forced-JSON pattern
 * geminiNlIntent.js uses) mirror the roles in config/a2a/roles.js:
 * 1. Decision Maker: should this task be delegated at all?
 * 2. Specialist Coordinator: which of the vertical's specialist tools fits the request?
 * 3. Authorization Reviewer: does this look approvable ahead of PingOne Authorize?
 *
 * config/a2aSpecialists.js maps each vertical to exactly ONE specialist, so the
 * real per-request ambiguity is not "which agent" but "which tool" that specialist
 * should be constrained to (delegateToSpecialist's opts.tool). Stage 2 is skipped
 * when the specialist only exposes one tool (true for 7 of the 8 configured verticals).
 *
 * Any stage failure (proxy unreachable, invalid/unparseable JSON, schema mismatch)
 * aborts the whole LLM pipeline and falls back to the keyword heuristic below —
 * no partial LLM/heuristic mixing.
 *
 * Once approved, execution is handed off to a2aDelegationService, which performs
 * the actual RFC 8693 token exchange — untouched by this file.
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
const { callLlamaCpp } = require('./llamacppLlmService');
const { repairAndParseJson } = require('./llmResponseContract');

const DECISION_SCHEMA = {
  type: 'object',
  required: ['shouldDelegate', 'reason', 'sensitivity'],
  properties: {
    shouldDelegate: { type: 'boolean' },
    reason: { type: 'string' },
    sensitivity: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
};

function coordinatorSchema(tools) {
  return {
    type: 'object',
    required: ['tool', 'reasoning'],
    properties: {
      tool: { type: 'string', enum: tools },
      reasoning: { type: 'string' },
    },
  };
}

const AUTHORIZATION_SCHEMA = {
  type: 'object',
  required: ['approved', 'blockers'],
  properties: {
    approved: { type: 'boolean' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
};

/** Flatten a CrewAI-style role object into a system prompt string. */
function rolePrompt(role) {
  return `${role.role}\n\nGoal: ${role.goal}\n\nBackstory: ${role.backstory}`;
}

/** Call the local LLM proxy with a forced JSON schema and parse+validate the reply. */
async function callStage(role, task, schema, validate) {
  const raw = await callLlamaCpp(
    [
      { role: 'system', content: rolePrompt(role) },
      { role: 'user', content: task.description },
    ],
    { jsonSchema: schema },
  );
  const parsed = repairAndParseJson(raw);
  if (!parsed || !validate(parsed)) {
    throw new Error(`LLM stage "${role.role}" returned an invalid reply: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

/**
 * LLM-backed orchestration: decision -> specialist coordination (tool pick,
 * skipped when there's only one tool) -> authorization review. Throws on any
 * stage failure — orchestrateDelegation falls back to heuristicOrchestration.
 */
async function llmOrchestration({ message, vertical }) {
  const decision = await callStage(
    DECISION_MAKER_ROLE,
    buildDecisionTask(DECISION_MAKER_ROLE, message),
    DECISION_SCHEMA,
    (p) => typeof p.shouldDelegate === 'boolean',
  );

  if (!decision.shouldDelegate) {
    return {
      shouldDelegate: false,
      reason: decision.reason || 'Message does not indicate need for specialist delegation',
      specialist: null,
      tool: null,
      scopes: [],
      authorized: false,
      sensitivity: decision.sensitivity || 'low',
    };
  }

  const specialist = specialistForVertical(vertical);
  if (!specialist) {
    return {
      shouldDelegate: true,
      reason: 'Delegation indicated but no specialist configured for this vertical',
      specialist: null,
      tool: null,
      scopes: [],
      authorized: false,
      sensitivity: decision.sensitivity || 'low',
    };
  }

  let tool;
  if (specialist.tools.length === 1) {
    tool = specialist.tools[0];
  } else {
    const coordinatorTask = buildCoordinatorTask(SPECIALIST_COORDINATOR_ROLE, vertical, specialist.tools, message);
    const coordinator = await callStage(
      SPECIALIST_COORDINATOR_ROLE,
      coordinatorTask,
      coordinatorSchema(specialist.tools),
      (p) => specialist.tools.includes(p.tool),
    );
    tool = coordinator.tool;
  }

  const authTask = buildAuthorizationTask(AUTHORIZATION_REVIEWER_ROLE, specialist.specialistName, tool);
  const authorization = await callStage(
    AUTHORIZATION_REVIEWER_ROLE,
    authTask,
    AUTHORIZATION_SCHEMA,
    (p) => typeof p.approved === 'boolean',
  );

  return {
    shouldDelegate: true,
    reason: `Delegation approved to ${specialist.specialistName}`,
    specialist: vertical,
    tool,
    scopes: [],
    authorized: authorization.approved === true,
    sensitivity: decision.sensitivity || 'low',
  };
}

/**
 * Orchestrate an A2A delegation request: LLM-backed decision (falling back to
 * a keyword heuristic on any LLM failure) then execute delegation.
 * Returns: { shouldDelegate, specialist, scopes, authorized, token, tokenEvents, claims, agentHeader, metadata, error? }
 */
async function orchestrateDelegation({ req, message, vertical, userId, availableSpecialists = [] }) {
  appEventService.logEvent('a2a', 'info', 'A2A orchestration starting', {
    tag: 'a2a/orchestrate',
    metadata: { vertical, userId },
  });

  let orchestrationResult;
  let usedLlm = false;
  try {
    orchestrationResult = await llmOrchestration({ message, vertical });
    usedLlm = true;
    appEventService.logEvent('a2a', 'info', 'A2A orchestration via LLM', {
      tag: 'a2a/llm_complete',
      metadata: orchestrationResult,
    });
  } catch (err) {
    appEventService.logEvent('a2a', 'warn', 'A2A LLM orchestration failed — falling back to heuristics', {
      tag: 'a2a/llm_failed',
      metadata: { error: err.message },
    });
    orchestrationResult = await heuristicOrchestration({ message, vertical, availableSpecialists });
    appEventService.logEvent('a2a', 'info', 'A2A orchestration via heuristics', {
      tag: 'a2a/heuristic_fallback',
      metadata: orchestrationResult,
    });
  }

  const agentHeader = usedLlm
    ? '🤖 [A2A ORCHESTRATOR - LLM (llama.cpp)]'
    : '🤖 [A2A ORCHESTRATOR - Heuristic Fallback]';
  const metadata = {
    framework: usedLlm ? 'llama.cpp' : 'heuristic',
    agentType: 'orchestrator',
  };

  try {
    if (!orchestrationResult.shouldDelegate || !orchestrationResult.authorized) {
      appEventService.logEvent('a2a', 'info', 'A2A delegation not approved', {
        tag: 'a2a/delegation_denied',
        metadata: { reason: orchestrationResult.reason },
      });
      return { ...orchestrationResult, token: null, tokenEvents: [], claims: null, agentHeader, metadata };
    }

    const specialist = specialistForVertical(orchestrationResult.specialist);
    if (!specialist) {
      const errMsg = `No specialist configured for vertical "${orchestrationResult.specialist}"`;
      appEventService.logEvent('a2a', 'error', 'A2A specialist not found', {
        tag: 'a2a/specialist_not_found',
        metadata: { vertical: orchestrationResult.specialist },
      });
      return { ...orchestrationResult, token: null, tokenEvents: [], claims: null, error: errMsg, agentHeader, metadata };
    }

    const delegationResult = await delegateToSpecialist(req, {
      vertical: orchestrationResult.specialist,
      tool: orchestrationResult.tool,
      subtask: message,
    });

    if (delegationResult.error) {
      appEventService.logEvent('a2a', 'error', 'A2A delegation execution failed', {
        tag: 'a2a/delegation_failed',
        metadata: { error: delegationResult.error },
      });
      return { ...orchestrationResult, ...delegationResult, agentHeader, metadata };
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
      agentHeader,
      metadata: {
        ...metadata,
        features: ['LLM-backed delegation decision', 'RFC 8693 token exchange', 'heuristic fallback'],
      },
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
      agentHeader,
      metadata,
    };
  }
}

/**
 * Heuristic-based A2A orchestration — no external dependencies. Used only when
 * the LLM pipeline above fails or is unreachable.
 */
async function heuristicOrchestration({ message, vertical, availableSpecialists }) {
  const lowerMessage = message.toLowerCase();

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

  const scopes = deriveMinimalScopes(specialist, lowerMessage);

  return {
    shouldDelegate: true,
    reason: `Delegation approved to ${specialist.specialistName || specialist.name || specialist.id}`,
    specialist: vertical,
    scopes,
    authorized: true,
    sensitivity,
  };
}

/** Select the best specialist for the message using heuristics. */
function selectSpecialist({ message, vertical, availableSpecialists }) {
  const configuredSpecialist = specialistForVertical(vertical);
  if (configuredSpecialist) {
    return configuredSpecialist;
  }

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

  return availableSpecialists[0] || null;
}

/** Derive minimal scopes needed for the specialist based on the message. */
function deriveMinimalScopes(specialist, message) {
  if (!specialist.scopes || specialist.scopes.length === 0) {
    return ['read'];
  }

  const scopes = new Set(specialist.scopes);

  if (message.includes('view') || message.includes('check') || message.includes('show')) {
    scopes.delete('write');
    scopes.delete('delete');
  }

  return [...scopes];
}

module.exports = {
  orchestrateDelegation,
};
