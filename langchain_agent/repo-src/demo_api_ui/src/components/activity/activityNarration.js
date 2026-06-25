/**
 * activityNarration.js — pure mappers from agent state to plain-English steps.
 * No React, no side effects. A Step is:
 *   { key, text, status: 'running'|'done'|'failed', tone: 'neutral'|'security'|'error' }
 */
import { renderTemplate, toolPhrase } from './activityVocab';

const STEP_UP_RE = /step.?up|mfa|ciba/i;
const HITL_RE = /consent|hitl|approval/i;

/** One step per tool call; present tense while running, past tense when done. */
export function reconcileToolSteps(toolCalls = []) {
  return toolCalls.map((tc) => {
    const phrase = toolPhrase(tc.name);
    const done = tc.status === 'done';
    return {
      key: `tool:${tc.id}`,
      text: done
        ? renderTemplate('toolDone', { phrase: phrase.done })
        : renderTemplate('toolRunning', { phrase: phrase.running }),
      status: done ? 'done' : 'running',
      tone: 'neutral',
    };
  });
}

/** Map an authorize decision (+ obligations) to a security-tone step. */
export function authorizeDecisionToStep(decision, institution) {
  const obligations = Array.isArray(decision?.obligations) ? decision.obligations : [];
  const types = obligations.map((o) => String(o?.type || o || ''));
  const key = `authz:${decision?.id ?? 'unknown'}`;

  if (types.some((t) => STEP_UP_RE.test(t))) {
    return { key, text: renderTemplate('stepUp', { institution }), status: 'running', tone: 'security' };
  }
  if (types.some((t) => HITL_RE.test(t))) {
    return { key, text: renderTemplate('hitl', { institution }), status: 'running', tone: 'security' };
  }
  const verdict = String(decision?.decision || '').toUpperCase();
  if (verdict === 'DENY') {
    return { key, text: renderTemplate('deny', { institution }), status: 'failed', tone: 'security' };
  }
  return { key, text: renderTemplate('permit', { institution }), status: 'done', tone: 'security' };
}

export function errorStep(institution) {
  return { key: 'error', text: renderTemplate('error', { institution }), status: 'failed', tone: 'error' };
}

export function hitlStep() {
  return { key: 'hitl', text: renderTemplate('hitl', {}), status: 'running', tone: 'security' };
}

export function identityStep() {
  return { key: 'identity', text: renderTemplate('identity'), status: 'done', tone: 'neutral' };
}

export function delegationStep() {
  return { key: 'delegation', text: renderTemplate('delegation'), status: 'done', tone: 'neutral' };
}

export function answerStep() {
  return { key: 'answer', text: renderTemplate('answer'), status: 'done', tone: 'neutral' };
}

/**
 * Map a server-emitted semantic activity record (from the BFF
 * activityStepsBuilder) to a friendly, vertical-aware Step, reusing the same
 * mappers the AG-UI path uses. Unknown kinds → null (caller filters).
 *   { kind, status, data } → Step | null
 */
export function mapActivityRecord(record, institution) {
  if (!record?.kind) return null;
  switch (record.kind) {
    case 'identity': return identityStep();
    case 'delegation': return delegationStep();
    case 'authorize': return authorizeDecisionToStep(record.data || {}, institution);
    case 'tool': return reconcileToolSteps([record.data || {}])[0] || null;
    case 'error': return errorStep(institution);
    case 'answer': return answerStep();
    default: return null;
  }
}
