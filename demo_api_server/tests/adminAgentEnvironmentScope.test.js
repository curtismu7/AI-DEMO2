'use strict';

/**
 * The PingOne environment is fixed server-side: PingOneUserService builds
 * baseUrl as /v1/environments/{PINGONE_ENVIRONMENT_ID}, and the hosted MCP
 * session is scoped the same way. Every admin call is therefore already
 * pointed at the right environment before it leaves the BFF.
 *
 * The admin agent did not know that. Running Demo step ADMIN2 ("List users")
 * produced "I need the ID of the PingOne environment you're working in" —
 * the model applying general PingOne knowledge, because nothing in its system
 * prompt said the environment was already decided. A demo step that stops to
 * ask for a value the server holds is a dead end.
 *
 * Two guards, because a prompt instruction only works if the model complies
 * and the admin agent's provider is configurable.
 */

const { buildAdminSystemPrompt } = require('../config/admin/systemPrompt');

describe('admin agent — environment is fixed server-side', () => {
  it('tells the model never to ask for or pass an environment ID', () => {
    const prompt = buildAdminSystemPrompt(null);
    expect(prompt).toMatch(/never ask the admin for an environment id/i);
    expect(prompt).toMatch(/never pass environmentid/i);
  });

  it('keeps that instruction when a customer is already selected', () => {
    const prompt = buildAdminSystemPrompt({ id: 'u1', name: 'Demo User' });
    expect(prompt).toMatch(/never ask the admin for an environment id/i);
  });

  // Independent of the model: the wrapper drops environmentId rather than
  // forwarding it, so a model that ignores the instruction still works.
  it('strips environmentId from tool arguments before dispatch', () => {
    const src = require('fs').readFileSync(
      require('path').resolve(__dirname, '../config/verticals/pingone-admin/tools.js'),
      'utf8',
    );
    expect(src).toMatch(/environmentId:\s*_ignoredEnvId,\s*\.\.\.args/);
  });
});
