'use strict';

/**
 * Jev (TypeSafe "System One" decision model) — scenario-locked client.
 *
 * The question definitions live HERE, never in the request: the public learning
 * page may only pick a scenario and supply the text to judge, so this route can
 * not be used as an open proxy to the paid OpenRouter key.
 *
 * Local alternative: set JEV_ENDPOINT=http://host:port/v1/systemone and
 * JEV_MODEL=von-1.3.0 for an open-source Von container (no key; same wire shape,
 * confirmed against a running von-1.3.0).
 *
 * Without OPENROUTER_API_KEY or JEV_ENDPOINT every call returns `mode: 'simulated'` from a
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
// OpenRouter answers in well under a second, so 5s is a real fault. A local server
// (Von) spends ~25s loading weights on its first calls after a cold start; a short
// timeout turns every one of those into a "Jev did not answer" error.
const TIMEOUT_MS = process.env.JEV_ENDPOINT ? 60000 : 5000;
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
  // ---- Jev demo gallery scenarios (jevGalleryPages.js). Same trust boundary:
  // the question lives HERE, the client may only pick a key and send text.
  prCheck: {
    key: 'prCheck',
    question: {
      type: 'noul',
      instructions:
        'Does this code change introduce the described risk? Answer for the diff snippet given.',
    },
  },
  uiAction: {
    key: 'uiAction',
    question: {
      type: 'choice',
      instructions: 'Which single next action completes the stated goal on this screen?',
      criteria: {
        click: 'The next step is activating the described control',
        type: 'The next step is entering text into the described field',
        navigate: 'The next step is opening another screen or menu to reach the control',
        done: 'The goal is already complete; nothing left to do',
      },
    },
  },
  linkPair: {
    key: 'linkPair',
    question: {
      type: 'noul',
      instructions:
        'Would a reader of the first page plausibly want a link to the second page, anchored in context?',
    },
  },
  docType: {
    key: 'docType',
    question: {
      type: 'choice',
      instructions: 'Which document type is this page?',
      criteria: {
        w2: 'Form W-2, wage and tax statement from an employer',
        _1099_int: 'Form 1099-INT, interest income from a bank',
        _1099_div: 'Form 1099-DIV, dividends and distributions',
        _1099_misc: 'Form 1099-MISC, miscellaneous income',
        receipt: 'A purchase receipt or expense receipt',
        invoice: 'A bill or invoice requesting payment',
        unknown: 'None of the listed types fit this page',
      },
    },
  },
  gameMove: {
    key: 'gameMove',
    question: {
      type: 'choice',
      instructions: 'Which action keeps the runner alive for the next stretch of track?',
      criteria: {
        stay: 'Stay in the current lane',
        left: 'Move one lane left',
        right: 'Move one lane right',
        jump: 'Jump over the obstacle ahead',
        slide: 'Slide under the obstacle ahead',
      },
    },
  },
  keepTurn: {
    key: 'keepTurn',
    question: {
      type: 'noul',
      instructions:
        'Would an agent still need this exact item in a later turn of the conversation to do its job correctly?',
    },
  },
  tradeSide: {
    key: 'tradeSide',
    question: {
      type: 'choice',
      instructions: 'Given this price move, which side should the bot take on the next block?',
      criteria: {
        buy: 'Momentum says the price is likely to keep rising',
        sell: 'Momentum says the price is likely to keep falling',
      },
    },
  },
  paperTopic: {
    key: 'paperTopic',
    question: {
      type: 'choice',
      instructions: 'Which topic best fits this paper title and abstract?',
      criteria: {
        agents: 'Autonomous agents, planning, tool use, multi-agent systems',
        alignment: 'Alignment, safety, oversight, interpretability',
        evals: 'Evaluation, benchmarks, measurement of model behaviour',
        rag: 'Retrieval, memory, grounding, external knowledge',
        fine_tuning: 'Training methods, fine-tuning, adaptation, efficiency of training',
        inference: 'Serving, quantization, decoding, inference-time speedups',
        multimodal: 'Vision, audio, video, multimodal models',
        reasoning: 'Chain of thought, search, test-time compute, formal reasoning',
        security: 'Prompt injection, jailbreaks, model attacks and defences',
        other: 'None of the listed topics fit',
      },
    },
  },
};

const INJECTION_RE = /ignore (all |any )?(previous|prior|above)|disregard|system prompt|reveal|exfiltrat|send .* to .*@|bypass/i;
const TRANSFER_RE = /\b(transfer|send|move|wire|pay)\b/i;
const BALANCE_RE = /\b(balance|how much|statement|recent)\b/i;
const RISK_RE = /\b(urgent|immediately|gift ?card|crypto|new payee|overseas|wire)\b|\$\s?\d{4,}/i;
// Gallery heuristics — keyword baselines for the demo pages, same "brittle rules" role.
const SECRET_RE = /(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}|(AKIA|ghp_|sk-)[A-Za-z0-9]{8,}/i;
const SQLI_RE = /(\+\s*(req|params|body|input)|`\s*\+\s*\w+\s*`|['"]\s*\+\s*\w+\s*\+\s*['"]).*(select|insert|update|delete|where)|string concatenation in (a )?(sql|query)/i;
const AUTH_RE = /auth|login|session|jwt|permission|rbac|oauth/i;
const DELETED_TEST_RE = /-.*(describe|it|test)\(|removed tests|deleted tests/i;
const PRICE_UP_RE = /\+/;
const W2_RE = /w-?2|wage and tax/i;
const INT_1099_RE = /1099-int|interest income/i;
const DIV_1099_RE = /1099-div|dividend/i;
const MISC_1099_RE = /1099-misc|misc(ellaneous)? income/i;
const RECEIPT_RE = /receipt|total|paid|card ending/i;
const INVOICE_RE = /invoice|amount due|net \d+|purchase order/i;
const OBSTACLE_AHEAD_RE = /obstacle|barrier|train|hurdle/i;
const LOW_CLEARANCE_RE = /overhead|low clearance|beam/i;
const KEEP_HINT_RE = /error|assert|failing|test result|command (ran|executed)|exit code|stack trace/i;
const RECENT_TURN_RE = /\[(?:t-?0|last)\]/i;
const MOMENTUM_RE = /\+\d|\d up|rising|green|gaining/i;

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
  if (scenarioKey === 'prCheck') {
    const hit = SECRET_RE.test(state) || SQLI_RE.test(state) || (AUTH_RE.test(state) && DELETED_TEST_RE.test(state));
    return { type: 'noul', probability: hit ? 1 : 0 };
  }
  if (scenarioKey === 'uiAction') {
    const choice = /type|enter|input field/i.test(state)
      ? 'type'
      : /menu|another screen|navigate|open/i.test(state)
        ? 'navigate'
        : /already (done|complete)|nothing left/i.test(state)
          ? 'done'
          : 'click';
    const probabilities = { click: 0, type: 0, navigate: 0, done: 0 };
    probabilities[choice] = 1;
    return { type: 'choice', choice, probabilities, confidence: 1 };
  }
  if (scenarioKey === 'linkPair') {
    // Shares a rare keyword = "relevant". No notion of reader intent.
    const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{5,}/g) || []);
    const [a, b] = String(state).split('\n---\n');
    const wa = words(a || ''), wb = words(b || '');
    let overlap = 0;
    wa.forEach((w) => { if (wb.has(w)) overlap += 1; });
    return { type: 'noul', probability: overlap >= 2 ? 1 : 0 };
  }
  if (scenarioKey === 'docType') {
    const choice = W2_RE.test(state)
      ? 'w2'
      : INT_1099_RE.test(state)
        ? '_1099_int'
        : DIV_1099_RE.test(state)
          ? '_1099_div'
          : MISC_1099_RE.test(state)
            ? '_1099_misc'
            : INVOICE_RE.test(state)
              ? 'invoice'
              : RECEIPT_RE.test(state)
                ? 'receipt'
                : 'unknown';
    const probabilities = { w2: 0, _1099_int: 0, _1099_div: 0, _1099_misc: 0, receipt: 0, invoice: 0, unknown: 0 };
    probabilities[choice] = 1;
    return { type: 'choice', choice, probabilities, confidence: 1 };
  }
  if (scenarioKey === 'gameMove') {
    const choice = LOW_CLEARANCE_RE.test(state)
      ? 'slide'
      : OBSTACLE_AHEAD_RE.test(state)
        ? 'jump'
        : /gap on the (left|right)/i.test(state)
          ? (RegExp.$1.toLowerCase() === 'left' ? 'left' : 'right')
          : 'stay';
    const probabilities = { stay: 0, left: 0, right: 0, jump: 0, slide: 0 };
    probabilities[choice] = 1;
    return { type: 'choice', choice, probabilities, confidence: 1 };
  }
  if (scenarioKey === 'keepTurn') {
    const hit = KEEP_HINT_RE.test(state) || RECENT_TURN_RE.test(state);
    return { type: 'noul', probability: hit ? 1 : 0 };
  }
  if (scenarioKey === 'tradeSide') {
    const choice = MOMENTUM_RE.test(state) ? 'buy' : 'sell';
    const probabilities = { buy: 0, sell: 0 };
    probabilities[choice] = 1;
    return { type: 'choice', choice, probabilities, confidence: 1 };
  }
  if (scenarioKey === 'paperTopic') {
    const choice = /agent|tool use|planning/i.test(state)
      ? 'agents'
      : /injection|jailbreak|attack/i.test(state)
        ? 'security'
        : /chain[- ]of[- ]thought|reasoning|test[- ]time/i.test(state)
          ? 'reasoning'
          : /retriev|memory|grounding/i.test(state)
            ? 'rag'
            : /benchmark|evaluation/i.test(state)
              ? 'evals'
              : /quantiz|inference|serving|decoding/i.test(state)
                ? 'inference'
                : /fine[- ]tun|training|lora/i.test(state)
                  ? 'fine_tuning'
                  : /vision|multimodal|video|audio/i.test(state)
                    ? 'multimodal'
                    : /align|safety|interpret/i.test(state)
                      ? 'alignment'
                      : 'other';
    const probabilities = {};
    for (const k of ['agents', 'alignment', 'evals', 'rag', 'fine_tuning', 'inference', 'multimodal', 'reasoning', 'security', 'other']) probabilities[k] = 0;
    probabilities[choice] = 1;
    return { type: 'choice', choice, probabilities, confidence: 1 };
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

// Live when there is an OpenRouter key, or when JEV_ENDPOINT points at a
// TypeSafe-compatible server that needs none (e.g. a local Von container).
function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY || process.env.JEV_ENDPOINT);
}

/**
 * @param {'injection'|'intent'|'risk'} scenarioKey
 * @param {string} state the text to judge
 * @returns {Promise<{mode:'live'|'simulated', model:string, latencyMs:number, answer:object}>}
 */
async function evaluate(scenarioKey, state, { heuristicsOnly = false } = {}) {
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) throw Object.assign(new Error('Unknown scenario'), { status: 400 });
  const text = String(state || '').slice(0, MAX_STATE_CHARS);
  if (!text.trim()) throw Object.assign(new Error('state is required'), { status: 400 });

  const started = Date.now();
  if (heuristicsOnly || !isConfigured()) {
    // chosen: the page asked for heuristics, as opposed to Jev simply not being configured.
    return { mode: 'simulated', model: 'keyword-heuristic', ...(heuristicsOnly ? { chosen: true } : {}), latencyMs: Date.now() - started, answer: heuristic(scenarioKey, text) };
  }

  const { data } = await axios.post(
    ENDPOINT,
    { model: MODEL, state: text, questions: { q: scenario.question } },
    {
      timeout: TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        // never send the OpenRouter key to a custom endpoint
        ...(process.env.OPENROUTER_API_KEY && !process.env.JEV_ENDPOINT && { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }),
      },
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
