import { BankingToolRegistry } from '../BankingToolRegistry';
import { handlerMap } from '../handlers';

/**
 * Regression guard: every tool the registry advertises must have an executable
 * handler in handlerMap. On a gateway-less hop (Privilege/Procyon AI Gateway
 * client → mcp-server direct) there is no upstream gateway to intercept
 * gateway-disposition tools, so an advertised-but-unimplemented handler fails
 * at dispatch with "Unknown tool handler: executeX" (seen live 2026-08-18 for
 * all ten api_key feature tools, e.g. show_health_record).
 */
describe('registry handler coverage', () => {
  it('maps every registered tool handler to an implementation', () => {
    const missing = BankingToolRegistry.getAllTools()
      .filter((tool) => !handlerMap[tool.handler])
      .map((tool) => `${tool.name} -> ${tool.handler}`);
    expect(missing).toEqual([]);
  });
});
