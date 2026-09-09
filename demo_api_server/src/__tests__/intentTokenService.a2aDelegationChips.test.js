'use strict';

/**
 * @file intentTokenService.a2aDelegationChips.test.js
 * @description UC2/UC2.5 A2A delegation chips must reach their vertical's
 * specialist tool through the Intent Token, the same defect class as
 * intentTokenService.showcaseChips.test.js (weather / branch hours).
 *
 * Each vertical's UC2 trigger is a DIFFERENT literal phrase
 * (config/useCases.js A2A_TRIGGER_BY_VERTICAL), e.g. "show my sensitive
 * membership details" for sporting-goods. nlIntentParser.extractIntentAndConfidence
 * had no branch for any of them, so every one classified as "unknown" @0.3,
 * permittedToolsForIntent fell back to the vertical's read-only list (which
 * excludes the specialist tool), and PingGateway P1AZ denied with (measured
 * live 2026-09-08, sporting-goods, nested-act depth 2 — i.e. the SECOND,
 * already-delegated hop that UC2 expects to PERMIT):
 *
 *   intent_mismatch: tool "sensitive_membership_details" not permitted for intent "unknown"
 *
 * so UC2's expectedOutcome ('PERMIT') never had a chance to be reached.
 */

const { extractIntentAndConfidence } = require('../../services/nlIntentParser');
const { permittedToolsForIntent } = require('../../services/intentTokenService');
const { A2A_SPECIALISTS } = require('../../config/a2aSpecialists');

describe('A2A delegation chip prompts reach their vertical specialist tool', () => {
  it.each([
    ['show my sensitive membership details', 'sporting-goods'],
    ['show my sensitive order history', 'retail'],
    ['show my sensitive a&f order history', 'abercrombie-fitch'],
    ['show my sensitive tax record', 'government'],
    ['access my sensitive student finance', 'university'],
    ['show my sensitive payroll details', 'workforce'],
    ['show my sensitive supplier contract', 'manufacturing'],
    ['show my sensitive holdings', 'investment'],
    ['show my sensitive passenger record', 'airlines'],
    ['show my sensitive patient records', 'healthcare'],
  ])('%s (%s) classifies as a2a_specialist_handoff and permits the specialist tool', (prompt, vertical) => {
    const { intent } = extractIntentAndConfidence(prompt);
    expect(intent).toBe('a2a_specialist_handoff');
    const canonical = vertical === 'abercrombie-fitch' ? 'retail' : vertical;
    const expectedTools = A2A_SPECIALISTS[canonical].tools;
    expect(permittedToolsForIntent(intent, vertical)).toEqual(expect.arrayContaining(expectedTools));
  });

  // Vertical-neutral triggers: UC2's own un-overridden default (banking) and
  // UC2.5's orchestrator phrase (every vertical).
  it('"hand off to a specialist" (banking default) permits banking\'s specialist tools', () => {
    const { intent } = extractIntentAndConfidence('hand off to a specialist');
    expect(intent).toBe('a2a_specialist_handoff');
    expect(permittedToolsForIntent(intent, 'banking')).toEqual(A2A_SPECIALISTS.banking.tools);
  });

  it('"delegate this to a specialist" (UC2.5) resolves per vertical', () => {
    const { intent } = extractIntentAndConfidence('delegate this to a specialist');
    expect(intent).toBe('a2a_specialist_handoff');
    expect(permittedToolsForIntent(intent, 'sporting-goods'))
      .toEqual(['sensitive_membership_details']);
  });

  // The A2A branch sits ABOVE the accounts/transactions reads on purpose —
  // several trigger phrases contain "history"/"details", which those regexes
  // would otherwise steal. Must not steal from them either.
  it.each([
    ['show my balance', 'view_balance'],
    ['show my recent transactions', 'view_transactions'],
    ['show my accounts', 'view_accounts'],
    ['what are the branch hours', 'get_branch_hours'],
  ])('%s still classifies as %s', (prompt, intent) => {
    expect(extractIntentAndConfidence(prompt).intent).toBe(intent);
  });

  it('does not widen the unknown-intent fallback', () => {
    const fallback = permittedToolsForIntent('some_unclassified_intent', 'sporting-goods');
    expect(fallback).not.toContain('sensitive_membership_details');
  });

  it('an unrecognized vertical falls through instead of throwing', () => {
    expect(() => permittedToolsForIntent('a2a_specialist_handoff', 'not-a-real-vertical')).not.toThrow();
  });
});
