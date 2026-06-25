# Authz-Server Parity Checklist

## Before Each P1AZ Import

- [ ] Regenerate snapshot: `node snapshots/gen-authorize-snapshot.js`
- [ ] Verify snapshot is up-to-date: `node snapshots/gen-authorize-snapshot.js --check`
- [ ] Verify statement sharing: grep `"id":"34567890-0003".*"shared":true` snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json
- [ ] Run authz tests: `npm --prefix demo_mcp_gateway test -- mortgageDispatch.test.ts`
- [ ] Verify parity: consent tools (9) and step-up tools (7) match both engines

## Key Files to Sync

| File | Purpose |
|------|---------|
| `scope-topology.json` | Single source of truth for tool policies |
| `snapshots/gen-authorize-snapshot.js` | Generator (reconciles snapshot with SoT) |
| `snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json` | P1AZ import file |
| `demo_authz_server/routes/decision.js` | Mock authz decision logic |
| `demo_mcp_gateway/src/auth/toolScopes.ts` | Gateway scope validation |

## Decision Rules in Sync

### Consent-Gated Tools (9)
- book_appointment, checkout, create_transfer, extend_rental, request_time_off
- sensitive_membership_details, sensitive_order_history, sensitive_patient_records, sensitive_payroll_details

### Step-Up MFA Tools (7)
- create_deposit, create_withdrawal, release_record, release_records, release_transcript, release_work_order, submit_expense

### Statement Sharing
- Step-up statement (34567890-0003) MUST be `shared: true` — referenced by both transaction and MCP rules

### Amount Thresholds
- Deny ceiling: $2,000
- Step-up threshold: $500
- Consent threshold: $250

## Regenerate After Changes

Run snapshot generator after updating scope-topology.json:
```bash
node snapshots/gen-authorize-snapshot.js
git add snapshots/Super_Banking_Transaction_Authorization_P1AZ.snapshot.json
git commit -m "chore(authz): regenerate P1AZ snapshot from scope-topology.json"
```

Import to PingOne Authorize: upload snapshot → publish

## Verify Parity
```bash
npm --prefix demo_mcp_gateway test -- mortgageDispatch.test.ts
```

All 15 tests must pass.
