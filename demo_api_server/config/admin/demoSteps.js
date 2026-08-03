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
];

module.exports = { ADMIN_DEMO_STEPS };
