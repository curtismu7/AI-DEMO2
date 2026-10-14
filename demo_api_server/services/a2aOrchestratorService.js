'use strict';

/**
 * A2A Orchestrator Service — LLM-backed multi-stage delegation decisions.
 *
 * Two sequential LLM calls (local llama.cpp proxy, same forced-JSON pattern
 * geminiNlIntent.js uses) mirror the roles in config/a2a/roles.js:
 * 1. Decision Maker: should this task be delegated at all?
 * 2. Specialist Coordinator: which of the vertical's specialist tools fits the request?
 *
 * There is deliberately NO third "Authorization Reviewer" stage. It asked the
 * model whether PingOne Authorize would approve, then blocked the delegation on
 * that guess — and on the live tier it guessed "no" every time, so this route
 * never delegated. Authorization belongs to the PDP, which decides for real one
 * hop later inside the specialist executor. Do not reinstate a predictive gate.
 *
 * config/a2aSpecialists.js maps each vertical to exactly ONE specialist, so the
 * real per-request ambiguity is not "which agent" but "which tool" that specialist
 * should be constrained to the A2A executor's opts.tool. Stage 2 is skipped
 * when the specialist only exposes one tool (true for 7 of the 8 configured verticals).
 *
 * Any stage failure (proxy unreachable, invalid/unparseable JSON, schema mismatch)
 * aborts the whole LLM pipeline and falls back to the keyword heuristic below —
 * no partial LLM/heuristic mixing.
 *
 * Once approved, execution is handed to the existing A2A wire executor. The
 * specialist performs Exchange #2 and the PERMIT-gated tool call.
 */

const {
  DECISION_MAKER_ROLE,
  SPECIALIST_COORDINATOR_ROLE,
} = require('../config/a2a/roles');
const {
  buildDecisionTask,
  buildCoordinatorTask,
} = require('../config/a2a/tasks');

const appEventService = require('./appEventService');
const { specialistForVertical } = require('../config/a2aSpecialists');
const { callLlamaCpp } = require('./llamacppLlmService');
const configStore = require('./configStore');
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

/** Flatten a CrewAI-style role object into a system prompt string. */
function rolePrompt(role) {
  return `${role.role}\n\nGoal: ${role.goal}\n\nBackstory: ${role.backstory}`;
}

/** Call the local LLM proxy with a forced JSON schema and parse+validate the reply. */
async function callStage(role, task, schema, validate, stages, stage) {
  const started = Date.now();
  try {
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
  } finally {
    // Recorded on failure too: a stage that timed out still cost the caller its wait.
    stages.push({ stage, agent: role.role, ms: Date.now() - started });
  }
}

/** Per-stage latency for the response; totalMs is exactly the sum of the stages. */
function timingsOf(stages) {
  return { stages, totalMs: stages.reduce((n, s) => n + s.ms, 0) };
}

/**
 * LLM-backed orchestration: decision -> specialist coordination (tool pick,
 * skipped when there's only one tool) -> authorization review. Throws on any
 * stage failure — orchestrateDelegation falls back to heuristicOrchestration.
 */
async function llmOrchestration({ message, vertical, stages }) {
  const decision = await callStage(
    DECISION_MAKER_ROLE,
    buildDecisionTask(DECISION_MAKER_ROLE, message),
    DECISION_SCHEMA,
    (p) => typeof p.shouldDelegate === 'boolean',
    stages,
    'decision',
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
      stages,
      'coordinator',
    );
    tool = coordinator.tool;
  }

  // No LLM "authorization reviewer" stage. It asked the model to predict what
  // PingOne Authorize would say and then REFUSED to mint a token unless the
  // guess came back true — a model guessing another system's answer, with no
  // policy input, standing in front of the PDP that actually decides one hop
  // later. Measured 2026-08-29 on the live llama.cpp tier: 4 runs of 4 returned
  // approved:false, so this route never delegated at all, while the heuristic
  // path (which sets authorized:true unconditionally) would have. The real gate
  // is the RFC 8693 exchange + PingOne Authorize inside delegateToSpecialist,
  // and it answers for real — including DENY. Routing is this function's job;
  // authorization is not.
  return {
    shouldDelegate: true,
    reason: `Delegating to ${specialist.specialistName} — PingOne Authorize decides at the exchange`,
    specialist: vertical,
    tool,
    scopes: [],
    authorized: true,
    sensitivity: decision.sensitivity || 'low',
  };
}

/**
 * Orchestrate an A2A delegation request: LLM-backed decision (falling back to
 * a keyword heuristic on any LLM failure) then execute delegation.
 * Returns routing, execution, result and token-event evidence; never a bearer token.
 */
async function orchestrateDelegation({ req, message, vertical, userId, mode, availableSpecialists = [], tokenEvents = [] }) {
  appEventService.logEvent('a2a', 'info', 'A2A orchestration starting', {
    tag: 'a2a/orchestrate',
    metadata: { vertical, userId },
  });

  // Heuristics never calls the model. Anything else tries the LLM first and
  // falls back to the heuristic on failure. `mode` ('heuristics' | 'llm') is the
  // calling page's own choice; without it the global agent_mode decides.
  const heuristicOnly = (mode ?? configStore.getEffective('agent_mode')) === 'heuristics';

  let orchestrationResult;
  let usedLlm = false;
  const stages = [];
  try {
    if (heuristicOnly) throw new Error('heuristics mode selected');
    orchestrationResult = await llmOrchestration({ message, vertical, stages });
    usedLlm = true;
    appEventService.logEvent('a2a', 'info', 'A2A orchestration via LLM', {
      tag: 'a2a/llm_complete',
      metadata: orchestrationResult,
    });
  } catch (err) {
    if (!heuristicOnly) {
      appEventService.logEvent('a2a', 'warn', 'A2A LLM orchestration failed — falling back to heuristics', {
        tag: 'a2a/llm_failed',
        metadata: { error: err.message },
      });
    }
    const heuristicStart = Date.now();
    orchestrationResult = await heuristicOrchestration({ message, vertical, availableSpecialists });
    stages.push({ stage: 'decision', agent: 'heuristic', ms: Date.now() - heuristicStart });
    appEventService.logEvent('a2a', 'info', 'A2A orchestration via heuristics', {
      tag: heuristicOnly ? 'a2a/heuristic_mode' : 'a2a/heuristic_fallback',
      metadata: orchestrationResult,
    });
  }

  const agentHeader = usedLlm
    ? '[A2A ORCHESTRATOR - LLM (llama.cpp)]'
    : heuristicOnly ? '[A2A ORCHESTRATOR - Heuristics]' : '[A2A ORCHESTRATOR - Heuristic Fallback]';
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
      return { ...orchestrationResult, token: null, tokenEvents: [], claims: null, agentHeader, metadata, timings: timingsOf(stages) };
    }

    const specialist = specialistForVertical(orchestrationResult.specialist);
    if (!specialist) {
      const errMsg = `No specialist configured for vertical "${orchestrationResult.specialist}"`;
      appEventService.logEvent('a2a', 'error', 'A2A specialist not found', {
        tag: 'a2a/specialist_not_found',
        metadata: { vertical: orchestrationResult.specialist },
      });
      return { ...orchestrationResult, token: null, tokenEvents: [], claims: null, error: errMsg, agentHeader, metadata, timings: timingsOf(stages) };
    }

    // Use the same specialist wire handoff as the normal A2A agent path. That
    // path lets the specialist perform Exchange #2 and dispatch its tool under
    // the PERMIT gate; this orchestrator must not mint Exchange #2 itself.
    const { executeA2aDelegation } = require('./demoAgentLangGraphService');
    const delegationStart = Date.now();
    const executionJson = await executeA2aDelegation(orchestrationResult.specialist, {
      tool: orchestrationResult.tool,
      subtask: message,
      args: {},
    }, { req, tokenEvents, sessionId: req?.sessionID || '' });
    stages.push({ stage: 'specialist', agent: orchestrationResult.specialist, ms: Date.now() - delegationStart });
    let executionResult;
    try {
      executionResult = JSON.parse(executionJson);
    } catch (_error) {
      executionResult = { delegated: false, error: 'invalid_a2a_execution_response' };
    }
    // Treat this helper result as untrusted for response shaping: explicitly
    // whitelist display/audit fields so bearer tokens or claims can never leak
    // through /api/a2a/message, even if the helper contract changes later.
    const delegationResult = Object.fromEntries(
      ['delegated', 'specialist', 'vertical', 'specialistVertical', 'tool', 'actChainDepth', 'scopes', 'result', 'toolError', 'error', 'note', 'render']
        .filter((key) => Object.hasOwn(executionResult, key))
        .map((key) => [key, executionResult[key]]),
    );
    const executionSucceeded = delegationResult.delegated === true
      && delegationResult.toolError == null
      && delegationResult.actChainDepth === 2;

    if (!executionSucceeded) {
      const error = delegationResult.toolError
        || delegationResult.error
        || (delegationResult.actChainDepth !== 2 ? 'invalid_a2a_act_chain_depth' : 'a2a_tool_not_dispatched');
      appEventService.logEvent('a2a', 'error', 'A2A delegation execution failed', {
        tag: 'a2a/delegation_failed',
        metadata: { error, actChainDepth: delegationResult.actChainDepth },
      });
      return {
        ...orchestrationResult,
        ...delegationResult,
        tokenEvents,
        success: false,
        error,
        agentHeader,
        metadata,
        timings: timingsOf(stages),
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
      tokenEvents,
      success: true,
      agentHeader,
      metadata: {
        ...metadata,
        features: ['LLM-backed delegation decision', 'RFC 8693 token exchange', 'heuristic fallback'],
      },
      timings: timingsOf(stages),
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
      timings: timingsOf(stages),
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
    // Every vertical's UC2 prompt names a concrete sensitive record (account,
    // patient, payroll, tax, order, etc.), not literally "sensitive data".
    /\bsensitive\b/,
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
