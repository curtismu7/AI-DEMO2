'use strict';

const { servicesForVaultKey, applyRestart, applyK8sPatch } = require('../../scripts/lib/rotationTargets');

describe('rotationTargets', () => {
  test('maps a vault key to the services that consume it', () => {
    expect(servicesForVaultKey('PINGONE_MCP_GATEWAY_CLIENT_SECRET'))
      .toEqual(expect.arrayContaining(['mcp-gateway']));
  });

  test('uses the real compose service name, not the demo- prefixed guess', () => {
    expect(servicesForVaultKey('PINGONE_MCP_GATEWAY_CLIENT_SECRET'))
      .not.toEqual(expect.arrayContaining(['demo-mcp-gateway']));
  });

  test('TE_CLIENT_SECRET recreates both consumers: the BFF and ping-gateway', () => {
    expect(servicesForVaultKey('TE_CLIENT_SECRET'))
      .toEqual(expect.arrayContaining(['demo-api-server', 'ping-gateway']));
  });

  test('unknown key recreates the BFF, which reads every secret', () => {
    expect(servicesForVaultKey('SOMETHING_NEW')).toEqual(['demo-api-server']);
  });

  test('restart shells run-docker.sh, never a bare docker restart', () => {
    const execFile = jest.fn();
    applyRestart(['demo-api-server'], { execFile });
    const [cmd, args] = execFile.mock.calls[0];
    expect(cmd).toMatch(/run-docker\.sh$/);
    expect(args).toEqual(['restart', 'demo-api-server']);
  });

  test('k8s patch passes the secret on stdin, never in argv', () => {
    const execFile = jest.fn();
    applyK8sPatch('DEMO_SECRET', 'super-secret-value', { execFile });
    const [, args, opts] = execFile.mock.calls[0];
    expect(args.join(' ')).not.toContain('super-secret-value');
    expect(String(opts.input)).toContain('super-secret-value');
  });
});
