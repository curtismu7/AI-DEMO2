'use strict';

/**
 * Minimal scripted walkthrough for the PingOne Admin AI Agent's "Demo
 * steps" button. Deliberately NOT part of the 22-use-case banking
 * trust-ladder catalog in config/useCases.js — the admin agent has no
 * consent/HITL gate or tokenChain evidence narrative to attach, just
 * plain NL prompts against the live PingOne MCP tool set
 * (see services/adminAgentService.js).
 */
const ADMIN_DEMO_STEPS = [
  {
    id: 'ADMIN1',
    title: 'List applications',
    trigger: { type: 'chip', text: 'List all PingOne applications in this environment' },
  },
  {
    id: 'ADMIN2',
    title: 'List users',
    trigger: { type: 'chip', text: 'List the users in my PingOne environment' },
  },
  {
    id: 'ADMIN3',
    title: 'List populations',
    trigger: { type: 'chip', text: 'List the populations in my PingOne environment' },
  },
  {
    id: 'ADMIN4',
    title: 'Get environment',
    trigger: { type: 'chip', text: 'Get the details of my PingOne environment' },
  },
  // ADMIN5-7 exist because ADMIN1-4 are four unconditional reads in a row —
  // nothing is filtered, gated, or refused, so nothing is demonstrated. These
  // exercise the sw prefix filter (live PingOne SCIM filter, not client-side
  // row filtering) and the scope/role gating on the tool catalog.
  {
    id: 'ADMIN5',
    title: 'Search users by prefix',
    // queryPrompt: the UI intercepts this step and opens the username-filter
    // modal (AIAgent's userFilter prompt) instead of sending the text — the
    // presenter chooses the prefix live rather than demoing a hardcoded one.
    // The text remains the representative phrase the parse ledger verifies,
    // and the fallback if a surface without the modal dispatches the step.
    trigger: { type: 'chip', queryPrompt: 'userFilter', text: 'List the PingOne users whose username starts with curt' },
  },
  {
    id: 'ADMIN6',
    title: 'Filter applications (Demo*)',
    trigger: { type: 'chip', text: 'List the PingOne applications whose name starts with Demo' },
  },
  {
    id: 'ADMIN7',
    title: 'Show my available tools',
    trigger: { type: 'chip', text: 'What PingOne tools can I use right now?' },
  },
];

module.exports = { ADMIN_DEMO_STEPS };
