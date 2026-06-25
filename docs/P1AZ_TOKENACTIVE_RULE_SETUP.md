# P1AZ TokenActive Rule Setup

## Overview
When `introspectionProvider=p1az` is enabled, the MCP gateway passes RFC 7662 introspection result to PingOne Authorize as policy parameters:
- `TokenActive` (string: "true" or "false")
- `TokenIntrospectionSub` (string, optional)
- `TokenIntrospectionExp` (number, optional)

## Required P1AZ Policy Rule

Add the following condition to the MCP policy in PingOne Authorize console:

### Condition Definition: `TokenIsActive`

```
Name: TokenIsActive
Description: Validates that the introspection result shows TokenActive == "true"
Condition: TokenActive == "true"
```

### Policy Rule: `Deny if Token Not Active`

Add to the MCP authorization policy:

```
IF IsMcpToolCall AND NOT TokenIsActive
THEN DENY with reason "invalid_token"
     Statement: "MCP token is not active or has been revoked"
```

## Integration Steps

1. Log into PingOne Authorize console
2. Navigate to the MCP authorization policy
3. Add the `TokenIsActive` condition (see above)
4. Add the deny rule that checks `NOT TokenIsActive`
5. Export/save the policy
6. Import the updated snapshot into the deployment

## Example Policy Flow

```
IsMcpToolCall ✓
  → TokenIsActive ✓
    → HasValidActorChain ✓
      → PERMIT (proceed to MCP server)
      
IsMcpToolCall ✓
  → TokenIsActive ✗
    → DENY (invalid_token - token revoked/expired)
```

## Attributes Required

These attributes must be present in the Policy Decision request parameters (wired via MCP gateway):
- `TokenActive` — RFC 7662 introspection result (active: true → "true", active: false → "false")
- `TokenIntrospectionSub` — optional, user sub from introspection
- `TokenIntrospectionExp` — optional, token expiration timestamp

✅ All attributes are automatically passed by the gateway when `introspectionProvider=p1az`.

## Snapshot Export

After adding the rule in the console:
1. Export the policy as a snapshot
2. Save to `snapshots/Super_Banking_MCP_TokenActive_Rule.snapshot.json`
3. Commit to the repository
4. Deploy with the updated snapshot

## Verification

Test that P1AZ correctly evaluates TokenActive:
- Valid token (active: true) → should PERMIT
- Revoked token (active: false) → should DENY with "invalid_token"
