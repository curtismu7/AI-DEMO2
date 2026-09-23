'use strict';

// Shared by the plugin and the reusable teaching skill. Keeping the learning
// path data-only makes its order and checkpoints testable without running an
// LLM or a live OAuth exchange.
const CURRICULUM = Object.freeze([
  { id: 'oauth-foundations', title: 'OAuth foundations', topic: 'what is oauth', tool: 'explain_concept', panel: 'rfc-index', checkpoint: { question: 'What does an OAuth access token delegate?', answer: 'A bounded ability to call a resource server; it does not share the user password.' } },
  { id: 'authorization-code-pkce', title: 'Authorization Code + PKCE', topic: 'authorization code flow with pkce', tool: 'explain_concept', panel: 'login-flow', checkpoint: { question: 'Why is an intercepted authorization code insufficient?', answer: 'The attacker also needs the client-held PKCE code verifier to redeem it.' } },
  { id: 'tokens-and-oidc', title: 'Access tokens, refresh tokens, and OIDC', topic: 'difference between an id token and an access token', tool: 'inspect_token', panel: 'oidc-21', checkpoint: { question: 'Which token is for the client and which token is for the API?', answer: 'The ID token is for the client identity session; the access token authorizes the resource-server call.' } },
  { id: 'scopes-and-least-privilege', title: 'Scopes and least privilege', topic: 'scopes and least privilege', tool: 'demonstrate_scope_denial', panel: 'sensitive-data', checkpoint: { question: 'What should happen when a token lacks the required scope?', answer: 'The resource path must deny the call instead of relying on the model to behave.' } },
  { id: 'token-exchange-delegation', title: 'Token exchange and delegation', topic: 'token exchange and act may_act delegation', tool: 'demonstrate_token_exchange', panel: 'token-flow', checkpoint: { question: 'What do audience narrowing and act provide together?', answer: 'Audience narrowing limits where the token can go, while act records the delegated actor.' } },
  { id: 'human-in-the-loop', title: 'Human-in-the-loop approval', topic: 'demonstrate hitl approval', tool: 'demonstrate_hitl', panel: 'human-in-loop', checkpoint: { question: 'What proves a sensitive action was approved?', answer: 'A verified, single-use consent receipt is checked before the retry is permitted.' } },
]);

function getCurriculumStep(id) {
  return CURRICULUM.find((step) => step.id === id) || null;
}

function nextCurriculumStep(id) {
  const index = CURRICULUM.findIndex((step) => step.id === id);
  return index >= 0 && index + 1 < CURRICULUM.length ? CURRICULUM[index + 1] : null;
}

module.exports = { CURRICULUM, getCurriculumStep, nextCurriculumStep };
