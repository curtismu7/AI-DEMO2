# PF AI Agent RAR processor

This plugin implements the `banking_transaction` authorization detail for
PingFederate 13.1 or newer. It is an OAuth authorization-details processor
and is not part of a SAML flow.

## Build and test

Run the policy tests with a JDK 17 or newer:

```bash
./test.sh
```

Build the PF plugin against the target PingFederate installation:

```bash
PF_HOME=/path/to/pingfederate ./build.sh
```

The build produces `build/pf-ai-agent-rar.jar`. It includes the PF-INF
deployment descriptor and the plugin classes. Copy that JAR to
`$PF_HOME/server/default/deploy` and restart PingFederate. The demo does not
install or reload the plugin automatically.

## Processor policy

The processor accepts only `banking_transaction` details with these fields:

```json
{
  "type": "banking_transaction",
  "user_id": "demouser",
  "actions": ["transfer"],
  "source_account": "checking-100",
  "destination_account": "savings-200",
  "amount": 125,
  "currency": "USD"
}
```

The authenticated context must include a client ID, user key, and the
`transactions:write` scope. PingFederate must supply mapped user information
under `IN_PARAMETER_AUTH_DETAILS_USER_INFO` with `user_id`, `account_ids`,
`transaction_limit`, and `currency`. The processor rejects missing context,
unknown fields, a user mismatch, an account outside that mapping, a transfer
without write scope, a currency mismatch, or an amount above the mapped limit.

The allowed page scenario uses `checking-100` to `savings-200`, USD 125, and
the supplied PF user key. The denial scenario changes the user ID to a value
outside the authenticated context. The PF processor performs the decision;
the BFF reports only accepted/denied status and safe OIDC metadata.

## PingFederate setup

After deployment:

1. In **System → OAuth Settings → Authorization Detail Processors**, create an
   instance from **AI Demo banking_transaction processor**.
2. In **System → OAuth Settings → Authorization Detail Types**, add
   `banking_transaction` and select that processor instance.
3. Map the authenticated user's `user_id`, `account_ids`,
   `transaction_limit`, and `currency` into the OAuth policy attributes made
   available to the processor. Keep the `transactions:write` scope tied to the
   policy that authorizes transfers.
4. Configure the consent interface to render the authorization detail. Enable
   PAR and PKCE for the CIMD public client, allow authorization details, and
   enable `banking_transaction` for that client.
5. Set `PF_AI_RAR_ENABLED=true` only after the processor, authorization detail
   type, mappings, consent handling, and PAR flow are ready.

The feature page and callback are under `/pingfederate-ai-agent` and
`/api/pf-ai-agent`. Existing PingOne authorization flows and the native PF
ID-JAG demo use their own routes.
