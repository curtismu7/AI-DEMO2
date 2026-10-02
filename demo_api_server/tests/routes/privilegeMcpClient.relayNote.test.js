'use strict';
/**
 * The Request Trace painted two expected outcomes as errors: the modern
 * handshake probe (`server/discover`) that an older MCP server answers 400
 * before the client falls back to `initialize`, and a Privilege policy denial
 * (403). relayNote() tags those so the page can label them for what they are.
 */
const { relayNote } = require('../../routes/privilegeMcpClient').__test;

const privilege = { gatewayMode: 'privilege' };

describe('privilegeMcpClient relayNote', () => {
  it.each([400, 404, 405])('tags a %i answer to the server/discover probe as a handshake fallback', (status) => {
    expect(relayNote(privilege, { method: 'server/discover' }, status)).toBe('handshake_fallback');
  });

  it('does not tag a 400 on any other method', () => {
    expect(relayNote(privilege, { method: 'tools/list' }, 400)).toBeNull();
  });

  it('tags a 403 through the Privilege gateway as a policy denial', () => {
    expect(relayNote(privilege, { method: 'tools/call' }, 403)).toBe('policy_denied');
  });

  it('leaves a 403 from a non-Privilege door untagged', () => {
    expect(relayNote({ gatewayMode: 'direct' }, { method: 'tools/call' }, 403)).toBeNull();
  });

  it('leaves successes and other failures untagged', () => {
    expect(relayNote(privilege, { method: 'server/discover' }, 200)).toBeNull();
    expect(relayNote(privilege, { method: 'tools/list' }, 500)).toBeNull();
  });
});
