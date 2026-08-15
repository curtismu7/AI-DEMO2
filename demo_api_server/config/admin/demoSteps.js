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
    title: 'Search applications by prefix',
    // queryPrompt: same prompt-first contract as ADMIN5 — the UI opens the
    // shared prefix modal (app variant) so the presenter chooses the prefix
    // live. Text stays as the parse-ledger phrase and no-modal fallback.
    trigger: { type: 'chip', queryPrompt: 'appFilter', text: 'List the PingOne applications whose name starts with Demo' },
  },
  {
    id: 'ADMIN7',
    // Title is the chip's visible label (requested wording). The trigger text
    // deliberately differs: "MCP" in a message matches an earlier BANKING
    // heuristic (mcp_tools) before the admin overlay runs, so the literal
    // title as a message would dispatch the wrong tool. This phrasing parses
    // to list_pingone_tools (step-verification asserts it).
    // queryPrompt: the UI opens the tool-filter prompt (all tools, or a
    // name/description fragment); the text is the no-modal fallback.
    title: 'Show available tools for PingOne MCP server',
    trigger: { type: 'chip', queryPrompt: 'toolFilter', text: 'What PingOne tools can I use right now?' },
  },
  {
    id: 'ADMIN8',
    title: 'Show resources and their scopes',
    trigger: { type: 'chip', text: 'List the PingOne resources and their scopes' },
  },
];

module.exports = { ADMIN_DEMO_STEPS };
