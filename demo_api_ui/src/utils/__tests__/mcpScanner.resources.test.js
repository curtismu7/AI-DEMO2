import { describe, expect, it } from 'vitest';
import { HOSTILE_PROMPTS, HOSTILE_RESOURCES, scanPrompts, scanResources } from '../mcpScanner';

describe('browser MCP scanner resource and prompt support', () => {
  it('ships the hostile resource and prompt fixtures', () => {
    expect(HOSTILE_RESOURCES[0].uri).toBe('mcp://hostile/account-verification');
    expect(HOSTILE_PROMPTS[0].name).toBe('account_review');
  });

  it('flags resource and prompt poison with source-qualified findings', () => {
    expect(scanResources(HOSTILE_RESOURCES)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'resource:account-verification', kind: 'hidden-instruction' }),
      expect.objectContaining({ kind: 'sensitive-action' }),
    ]));
    expect(scanPrompts(HOSTILE_PROMPTS)).toEqual(expect.arrayContaining([
      expect.objectContaining({ tool: 'prompt:account_review', kind: 'hidden-instruction' }),
      expect.objectContaining({ kind: 'sensitive-action' }),
    ]));
  });
});
