/**
 * demoAgentLangGraphService.js — OKF Integration Patch
 *
 * This file shows the EXACT code to add at the prompt injection point
 * (~line 1407 in demoAgentLangGraphService.js, after the vertical manifest
 * system prompt is assembled).
 *
 * BEFORE (existing code, ~line 1405-1410):
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   // ... end of manifest system prompt assembly
 *   const systemPrompt = manifestPromptParts.join('\n');
 *
 *   // Create the messages array for the LLM call
 *   const messages = [
 *     { role: 'system', content: systemPrompt },
 *     ...conversationHistory,
 *   ];
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AFTER (with OKF injection):
 * ─────────────────────────────────────────────────────────────────────────────
 */

// --- ADD THIS REQUIRE AT THE TOP OF THE FILE (with other requires) ---
// const { injectOkfKnowledge } = require('./okfPromptInjector');

// --- REPLACE the prompt→messages section with: ---

/*

  // ... end of manifest system prompt assembly
  const systemPrompt = manifestPromptParts.join('\n');

  // ── OKF Knowledge Grounding ──────────────────────────────────────────────
  // When ff_okf_grounding is ON, appends deterministic knowledge assertions
  // from graphify-out/banking-domain.okf.json. The agent will cite these as
  // [K1]–[K12]. When OFF, this is a no-op (returns systemPrompt unchanged).
  const { injectOkfKnowledge } = require('./okfPromptInjector');
  const groundedPrompt = injectOkfKnowledge(systemPrompt, {
    domain: 'banking-domain',
  });
  // ─────────────────────────────────────────────────────────────────────────

  // Create the messages array for the LLM call
  const messages = [
    { role: 'system', content: groundedPrompt },
    ...conversationHistory,
  ];

*/

// ─────────────────────────────────────────────────────────────────────────────
// THAT'S IT. The flag + loader + injector handle everything else:
//
// • ff_okf_grounding OFF → groundedPrompt === systemPrompt (zero change)
// • ff_okf_grounding ON  → groundedPrompt === systemPrompt + <knowledge> block
//
// The SE flips the flag in the QuickFlagsPill header toggle (📚 OKF button)
// and asks the same question again to show the contrast.
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  INJECTION_POINT_LINE: '~1407',
  DESCRIPTION: 'Add OKF knowledge grounding after manifest system prompt assembly',
};
