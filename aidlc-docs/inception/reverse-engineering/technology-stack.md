# Technology Stack (scoped)

| Area | Stack |
|------|-------|
| UI | React, Vite, Jest |
| BFF | Node.js (demo_api_server) |
| MCP | TypeScript MCP server (`demo_mcp_server`) |
| Gateway | demo_mcp_gateway (token + authz) |
| Auth | PingOne, RFC 8693 Token Exchange |
| Agents | Python LangChain (+ OpenAI/Pydantic/Mastra variants) |
| Local LLM | demo_llm_proxy → llama.cpp / oMLX / mlx-lm |
| Tooling | graphify, npm topology/hygiene gates |

## Patterns to follow for new tool
1. Add definition in `BankingToolRegistry.ts` (`readOnly: true`, `requiresUserAuth: true`)
2. Map scopes in `toolScopeMap.ts` (likely `['read']`)
3. Implement handler under `src/tools/handlers/`
4. Wire provider method name to handler
5. Add Actions chip entry in UI chip config for the target vertical(s)
6. Format result via existing `formatResult` / Direct MCP formatting path
