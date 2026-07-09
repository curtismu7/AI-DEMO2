# Component Dependencies

```mermaid
flowchart TB
  Chip[agentActions.js chip]
  Agent[AIAgent.js]
  GW[demo_mcp_gateway]
  Reg[BankingToolRegistry]
  Handler[executeGetAccountNickname]
  API[BankingAPIClient]
  BFF[demo_api_server]

  Chip --> Agent
  Agent -->|tools/call| GW
  GW --> Reg
  Reg --> Handler
  Handler --> API
  API --> BFF
```

| From | To | Pattern |
|------|-----|---------|
| UI chip | AIAgent | id `account_nickname` |
| AIAgent | Gateway | Direct MCP / heuristic |
| Registry | Handler | string handler name |
| Handler | BFF | existing REST via API client |
