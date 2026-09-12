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

  // I5: every equivalent call in k8s/create-secrets.sh passes --namespace="$NS"
  // --type merge. Without them this only worked by accident, via whatever
  // namespace the current kubectl context defaulted to.
  test('k8s patch targets the namespace and merge type create-secrets.sh uses', () => {
    const execFile = jest.fn();
    applyK8sPatch('DEMO_SECRET', 'v', { execFile });
    expect(execFile.mock.calls[0][1].join(' '))
      .toContain('--namespace ai-demo --type merge');
  });

  test('k8s patch honours K8S_NAMESPACE', () => {
    const execFile = jest.fn();
    const prev = process.env.K8S_NAMESPACE;
    process.env.K8S_NAMESPACE = 'ai-demo-se';
    try {
      applyK8sPatch('DEMO_SECRET', 'v', { execFile });
    } finally {
      if (prev === undefined) delete process.env.K8S_NAMESPACE;
      else process.env.K8S_NAMESPACE = prev;
    }
    expect(execFile.mock.calls[0][1].join(' ')).toContain('--namespace ai-demo-se');
  });

  // M3: this process's stdout/stderr is redirected into a run log the BFF
  // serves over HTTP, and some kubectl 4xx responses echo request bodies.
  describe('child output never reaches the HTTP-served run log', () => {
    const leaky = () => {
      const err = new Error('Command failed: kubectl patch secret ai-demo-secrets');
      err.stderr = 'Error from server: {"stringData":{"DEMO_SECRET":"super-secret-value"}}';
      throw err;
    };

    test('restart captures child output instead of inheriting it', () => {
      const execFile = jest.fn();
      applyRestart(['demo-api-server'], { execFile });
      const [, , opts] = execFile.mock.calls[0];
      expect(opts.stdio).not.toContain('inherit');
    });

    test('k8s patch captures child output instead of inheriting it', () => {
      const execFile = jest.fn();
      applyK8sPatch('DEMO_SECRET', 'v', { execFile });
      const [, , opts] = execFile.mock.calls[0];
      expect(opts.stdio).not.toContain('inherit');
    });

    test('a failing restart surfaces a fixed remediation, not the raw output', () => {
      let thrown;
      try {
        applyRestart(['mcp-gateway', 'demo-api-server'], { execFile: leaky });
      } catch (err) { thrown = err; }
      expect(thrown.message).toContain('./run-docker.sh restart mcp-gateway demo-api-server');
      expect(thrown.message).not.toContain('super-secret-value');
      expect(thrown.message).not.toContain('Error from server');
    });

    test('a failing k8s patch surfaces a fixed remediation, not the raw output', () => {
      let thrown;
      try {
        applyK8sPatch('DEMO_SECRET', 'super-secret-value', { execFile: leaky });
      } catch (err) { thrown = err; }
      expect(thrown.message).toMatch(/patch failed/i);
      expect(thrown.message).not.toContain('super-secret-value');
      expect(thrown.message).not.toContain('Error from server');
    });
  });
});
