/**
 * activityVocab.js — plain-English templates for the "What's happening" panel.
 *
 * Templates use {institution} (the vertical's display noun) and {phrase}
 * (a tool verb) tokens. This is the only place demo copy lives.
 */

const TEMPLATES = {
  identity:   "Confirming it's really you…",
  delegation: 'The assistant is acting as you — allowed to look, not to move money.',
  permit:     'The {institution} approved the request.',
  deny:       "The {institution} said no — that action isn't allowed.",
  stepUp:     'The {institution} wants you to approve this on your phone first.',
  hitl:       'This needs your explicit OK before it can continue.',
  error:      "That didn't work — the assistant is trying another way.",
  toolRunning:'{phrase}…',
  toolDone:   '{phrase}',
  answer:     "Done — here's your answer.",
};

/** Substitute {institution}/{phrase} tokens. Unknown key → ''. Missing institution → 'service'. */
export function renderTemplate(key, vars = {}) {
  const tpl = TEMPLATES[key];
  if (tpl == null) return '';
  const institution = vars.institution || 'service';
  return tpl
    .replace(/\{institution\}/g, institution)
    .replace(/\{phrase\}/g, vars.phrase != null ? vars.phrase : '');
}

/** Friendly verb pair for known banking-style tools; humanized fallback otherwise. */
const TOOL_PHRASES = {
  get_balance:       { running: 'Reading your balance',        done: 'Read your balance' },
  list_transactions: { running: 'Looking up your transactions', done: 'Looked up your transactions' },
  transfer_funds:    { running: 'Setting up your transfer',     done: 'Set up your transfer' },
  deposit:           { running: 'Recording your deposit',       done: 'Recorded your deposit' },
  withdraw:          { running: 'Recording your withdrawal',    done: 'Recorded your withdrawal' },
};

export function toolPhrase(toolName) {
  if (toolName && TOOL_PHRASES[toolName]) return TOOL_PHRASES[toolName];
  const human = String(toolName || 'the task').replace(/[_-]+/g, ' ').trim();
  return { running: `Working on ${human}`, done: `Finished ${human}` };
}
