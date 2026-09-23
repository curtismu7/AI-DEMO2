import { describe, expect, it } from 'vitest';

import { ARCHITECTURE_NODES, ARCHITECTURE_EDGES } from './ArchitectureSimSvg';
import { SCENARIOS } from '../config/architecture-sim-scenarios';

describe('React Flow architecture proof of concept', () => {
  it('includes Vault and the protected Resource Server in the architecture', () => {
    const nodeIds = ARCHITECTURE_NODES.map((node) => node.id);
    const labels = ARCHITECTURE_NODES.map((node) => node.label);

    expect(nodeIds).toContain('n-vault');
    expect(labels).toContain('Vault / Secrets');
    expect(nodeIds).toContain('n-resource-server');
    expect(labels).toContain('Banking Resource Server');
  });

  it('shows the BFF secret lookup and MCP-to-resource-server boundaries', () => {
    const edgeIds = ARCHITECTURE_EDGES.map((edge) => edge.id);

    expect(edgeIds).toContain('e-bff-vault');
    expect(edgeIds).toContain('e-mcpgw-resourceserver');
    expect(edgeIds).toContain('e-resource-server-banking-data');
  });

  it('walks the protected request in runtime order', () => {
    const scenario = SCENARIOS.find((item) => item.id === 'mcp-tool-call');
    const steps = scenario.steps.map((step) => step.nodes[0]);

    expect(steps).toEqual([
      'n-browser',
      'n-bff',
      'n-vault',
      'n-mcp-gw',
      'n-pingone',
      'n-mcp-gw',
      'n-mcp-server',
      'n-resource-server',
      'n-banking-data',
      'n-browser',
    ]);
  });
});
