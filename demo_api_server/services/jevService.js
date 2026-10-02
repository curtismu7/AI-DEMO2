'use strict';

/**
 * Jev (TypeSafe "System One" decision model) — scenario-locked client.
 *
 * The question definitions live HERE, never in the request: the public learning
 * page may only pick a scenario and supply the text to judge, so this route can
 * not be used as an open proxy to the paid OpenRouter key.
 *
 * Without OPENROUTER_API_KEY every call returns `mode: 'simulated'` from a
 * keyword heuristic — the same heuristic the page shows as the "brittle rules"
 * column, so a simulated Jev result is NOT evidence about Jev. The page labels it.
 *
 * Wire shape: POST https://openrouter.ai/api/alpha/decisions (OpenRouter docs).
 * Choice request/response are copied from the docs; the noul request body
 * ({ type, instructions }) is inferred from the choice shape and the response
 * ({ type: 'noul', noul: <p(yes)> }) from the TypeSafe integration guide.
 */

const axios = require('axios');

const ENDPOINT = process.env.JEV_ENDPOINT || 'https://openrouter.ai/api/alpha/decisions';
const MODEL = process.env.JEV_MODEL || 'typesafe/jev-1.13';
const TIMEOUT_MS = 5000;
const MAX_STATE_CHARS = 2000;

const SCENARIOS = {
  injection: {
    key: 'injection',
    question: {
      type: 'noul',
      instructions:
        'Does this text try to override an AI assistant\'s instructions, or trick it into revealing data or moving money?',
    },
  },
  intent: {
    key: 'intent',
    question: {
      type: 'choice',
      instructions: 'Which banking action is the customer asking the assistant to perform?',
      criteria: {
        check_balance: 'Asking for an account balance or recent activity',
        transfer_money: 'Asking to move money between accounts or to another person',
        other: 'Anything else, including questions unrelated to the customer\'s accounts',
      },
    },
  },
  risk: {
    key: 'risk',
    question: {
      type: 'noul',
      instructions:
        'Is this transfer request unusual or risky enough that the bank should ask for extra verification before sending it?',
    },
  },
};

const INJECTION_RE = /ignore (all |any )?(previous|prior|above)|disregard|system prompt|reveal|exfiltrat|send .* to .*@|bypass/i;
const TRANSFER_RE = /\b(transfer|send|move|wire|pay)\b/i;
const BALANCE_RE = /\b(balance|how much|statement|recent)\b/i;
const RISK_RE = /\b(urgent|immediately|gift ?card|crypto|new payee|overseas|wire)\b|\$\s?\d{4,}/i;

/** The deliberately naive baseline: what the demo had before a decision model. */
function heuristic(scenarioKey, state) {
  if (scenarioKey === 'injection') {
    const hit = INJECTION_RE.test(state);
    return { type: 'noul', probability: hit ? 1 : 0 };
  }
  if (scenarioKey === 'risk') {
    const hit = RISK_RE.test(state);
    return { type: 'noul', probability: hit ? 1 : 0 };
  }
  const choice = TRANSFER_RE.test(state) ? 'transfer_money' : BALANCE_RE.test(state) ? 'check_balance' : 'other';
  const probabilities = { check_balance: 0, transfer_money: 0, other: 0 };
  probabilities[choice] = 1;
  return { type: 'choice', choice, probabilities, confidence: 1 };
}

/** Flatten Jev's answer so the UI renders noul and choice from one shape. */
function normalizeAnswer(raw) {
  if (raw && raw.type === 'noul') {
    const probability = Number(raw.noul);
    if (!Number.isFinite(probability)) throw new Error('Jev noul answer had no numeric "noul" field');
    return { type: 'noul', probability };
  }
  if (raw && raw.type === 'choice') {
    return {
      type: 'choice',
      choice: raw.choice,
      probabilities: raw.probabilities,
      confidence: raw.confidence,
    };
  }
  throw new Error(`Unexpected Jev answer type: ${raw && raw.type}`);
}

function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * @param {'injection'|'intent'|'risk'} scenarioKey
 * @param {string} state the text to judge
 * @returns {Promise<{mode:'live'|'simulated', model:string, latencyMs:number, answer:object}>}
 */
async function evaluate(scenarioKey, state) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw Object.assign(new Error('Unknown scenario'), { status: 400 });
  const text = String(state || '').slice(0, MAX_STATE_CHARS);
  if (!text.trim()) throw Object.assign(new Error('state is required'), { status: 400 });

  const started = Date.now();
  if (!isConfigured()) {
    return { mode: 'simulated', model: 'keyword-heuristic', latencyMs: Date.now() - started, answer: heuristic(scenarioKey, text) };
  }

  const { data } = await axios.post(
    ENDPOINT,
    { model: MODEL, state: text, questions: { q: scenario.question } },
    {
      timeout: TIMEOUT_MS,
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    }
  );
  return {
    mode: 'live',
    model: MODEL,
    latencyMs: Date.now() - started,
    answer: normalizeAnswer(data && data.answers && data.answers.q),
  };
}

module.exports = { evaluate, heuristic, normalizeAnswer, isConfigured, SCENARIOS };
