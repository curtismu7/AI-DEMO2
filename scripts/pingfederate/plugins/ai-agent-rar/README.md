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

Keep no other copy of the JAR in that directory. PingFederate loads every file
whose name contains `.jar`, so a `pf-ai-agent-rar.jar.bak` becomes a second
definition of the same processor ("Adapter ... is defined more than once") and
you cannot tell which version runs. Store a rollback copy outside `deploy`.

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

PingFederate 13.1 calls the processor in two phases, and only the second has a
user, so the checks are split the same way:

- **At push (PAR), no user yet.** The processor checks the shape only: the type,
  no unknown fields, the `transactions:write` scope, a present `user_id`, the
  `transfer` action, two different accounts, a positive amount and a currency.
  A malformed request is refused here with `invalid_authorization_details`. A
  well-formed one is accepted whatever its `user_id`.
- **After sign-in, in `enrich`.** The user is the context's user key when
  PingFederate supplies one; on 13.1 it does not, so the sign-in adapter's
  `username` attribute is used. The processor refuses a
  `user_id` that is not that user, an account that is not theirs, an amount above
  their limit, or a currency that differs from theirs. With no signed-in user it
  refuses; there is no shape-only fallback at this step.

The user's `user_id`, `account_ids`, `transaction_limit` and `currency` come from
the BFF when the instance's **User Limits URL** is set:
`GET /api/pf-ai-agent/rar/user-limits?username=`, sent with the **User Limits
Credential** as a bearer token (the vault entry `PF_AI_RAR_LOOKUP_SECRET`; the BFF
answers 401 for any other value and 404 for an unknown user). With the URL left
blank the processor reads the same four values from mapped user information
(`IN_PARAMETER_AUTH_DETAILS_USER_INFO`) instead.

The allowed page scenario transfers USD 125 between the signed-in user's first
two accounts. The denial scenario changes the user ID to a value outside the
authenticated context, so it passes the push-time check and is refused after
sign-in. The PF processor performs the decision; the BFF reports only
accepted/denied status and safe OIDC metadata.

## PingFederate setup

After the JAR is deployed and PingFederate restarted, run
`node scripts/pingfederate/provision-ai-agent-features.js --apply` (dry run
without `--apply`). It applies the `transactions:write` scope, the CIMD settings
and policy, the `PF_AI_RAR_LOOKUP_SECRET` vault entry (created once, never
replaced), the processor instance with its User Limits URL and credential, the
`banking_transaction` authorization detail type, and the public PKCE client
`ai-demo-pf-rar`. PingFederate 13.1 gives a CIMD client no authorization detail
types, which is why RAR has its own client; the BFF uses it when
`PF_AI_RAR_CLIENT_ID` is set. Run the script again without `--apply` and every
line should read "already in place".

Still manual:

1. Configure the consent interface to render the authorization detail.
2. Keep the `transactions:write` scope tied to the policy that authorizes
   transfers.
3. Set `PF_AI_RAR_ENABLED=true` only after the processor, authorization detail
   type, consent handling, and PAR flow are ready.

Mapping user attributes into the OAuth policy is no longer needed while the User
Limits URL is set.

The feature page and callback are under `/pingfederate-ai-agent` and
`/api/pf-ai-agent`. Existing PingOne authorization flows and the native PF
ID-JAG demo use their own routes.
