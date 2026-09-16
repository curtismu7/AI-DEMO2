# P1AZ account context resolver

The banking resource server exposes a narrow, read-only endpoint for PingOne
Authorize:

```text
GET /authorize/account-context?userId={{UserId}}&accountId={{AccountId}}
X-API-Key: <service credential>
```

It returns only the selected account's authorization context:

```json
{
  "accountId": "acct-002",
  "userId": "demo-user",
  "riskTier": "standard",
  "balance": 18540,
  "currency": "USD"
}
```

The endpoint is intended to remain private. Configure the PingOne Authorize
HTTP Service target through an Authorize Gateway that can reach the resource
server; do not publish the SQLite-backed endpoint directly to the internet.

## PingOne Authorize configuration

In Authorization → Trust Framework:

1. Create an HTTP service named `Banking Account Context`.
2. Configure `GET` with a target URL equivalent to:
   `https://<private-service-route>/authorize/account-context?userId={{UserId}}&accountId={{AccountId}}`.
3. Add the `X-API-Key` header using the service credential stored in the
   environment's secret configuration.
4. Keep TLS certificate validation enabled and use the Authorize Gateway for
   private routing.
5. Create a JSON attribute `AccountContext` with a Service resolver pointing
   at `Banking Account Context`.
6. Generate child attributes `AccountContext.RiskTier`,
   `AccountContext.Balance`, and `AccountContext.Currency` from the response
   JSON schema.
7. Add a deny rule for `AccountContext.RiskTier` not equal to `standard`.
   Missing or failed service resolution must remain fail-closed.

The checked-in snapshot generates `AccountId` and its request contract, but the
HTTP Service itself is intentionally a post-import environment step: its
private route, Authorize Gateway, and API-key secret are deployment-specific
and must not be embedded in a portable snapshot. Do not enable live decisions
until the service resolver and deny rule above are present in the target
environment.

`AccountId` is part of the generated P1AZ request contract. The BFF, Node MCP
gateway, and PingGateway Groovy PEPs send it from the selected account tool
argument. The SQLite schema defaults newly inserted accounts to `restricted`,
so a new account/user does not pass until it is explicitly assigned the
`standard` tier.

P1AZ HTTP services support URL interpolation, custom headers, and authenticated
service calls. See the [PingOne Authorize HTTP service documentation](https://docs.pingidentity.com/pingone/authorization_using_pingone_authorize/p1_az_connecting_an_http_service.html).
