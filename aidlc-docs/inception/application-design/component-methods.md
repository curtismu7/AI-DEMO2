# Component Methods

## C1 — executeGetAccountNickname
```
executeGetAccountNickname(deps, token, params) -> HandlerResult
  params: { account_id?: string }
  returns: { success, accountId, nickname, fallbackUsed?: boolean }
```

**Logic (high level)**:
1. Load accounts via `deps.apiClient.getMyAccounts(token)`
2. Pick account: by `account_id` if provided, else first checking (primary heuristic)
3. `nickname = account.name` if non-empty, else format `${accountType} …${last4}`
4. Return structured data for MCP + UI formatter

## C2 — Registry definition
```
get_account_nickname: BankingToolDefinition
  inputSchema: { account_id?: string }
  handler: 'executeGetAccountNickname' (or provider method name)
  readOnly: true
  requiredScopes: ['read']
```

## C5 — Chip definition
```
{ id: 'account_nickname', label: 'Account nickname', desc: '...', rfcs: ['8693','7515'] }
```

## C6 — AIAgent
- Existing Direct MCP path: resolve tool from chip → `callMcpTool` → `formatResult`
- Add `account_nickname` case in formatter if tool-specific shaping needed (else reuse accounts-style formatting)
