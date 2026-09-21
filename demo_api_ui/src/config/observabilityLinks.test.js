import { describe, expect, it } from 'vitest';
import { KIBANA_URL, MCP_OBSERVABILITY_PATH } from './observabilityLinks';

describe('observabilityLinks', () => {
  it('uses a browser URL for Kibana', () => {
    expect(KIBANA_URL).toMatch(/^https?:\/\//);
  });

  it('points the in-app link at the MCP observability route', () => {
    expect(MCP_OBSERVABILITY_PATH).toBe('/mcp-observability');
  });
});
