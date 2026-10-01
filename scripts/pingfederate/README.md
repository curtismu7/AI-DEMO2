# Local PingFederate (operator-run, outside Git)

PF is not part of the demo compose project. Start it from this directory with
two operator-supplied values that must never be committed:

```bash
export PINGFEDERATE_PROFILE_PATH="$HOME/pingfederate-profile"
export PINGFEDERATE_ADMIN_PASSWORD='<your admin password>'
docker compose -f docker-compose.local.yml up -d
```

## Recovering the profile (2026-09-26 incident)

The profile directory is a prepared PF classic instance (must contain
`instance/server/default/conf/pingfederate.lic`). If the host profile copy is
lost, rebuild it from the persistent OUT volume — it holds the full
configured instance, license included:

```bash
mkdir -p ~/pingfederate-profile
docker run --rm -v ai-demo-pingfederate-out:/out:ro -v "$HOME/pingfederate-profile":/profile \
  alpine sh -c "cp -a /out/instance /profile/"
```

Then point `PINGFEDERATE_PROFILE_PATH` at `~/pingfederate-profile`.

## Notes

- `PING_IDENTITY_PASSWORD` on an existing OUT volume: the image re-applies the
  admin password on boot, so after a rebuild-from-volume you set a NEW value
  and it takes effect (verified 2026-09-26 — container healthy, engine
  answering on 9031).
- The demo stack (`demo_api_server`, oauth flows) must be able to reach PF on
  `https://localhost:9031` and the compose alias `pingfederate` on the
  `ai-demo_ai-demo` network — this compose file already joins it.
- `npm run demo:health-gate` checks the container is up and healthy and will
  print this recovery path when it is missing.

## oauth-mcp Banking API Step 9

`oauth-mcp` runs a second RFC 8693 exchange for banking data tools. PingOne
subjects continue through PingOne's existing Step 9 client and `resource`
selector. PF subjects use a separate PF policy and ATM mapping; they do not
reuse or modify `aiDemoStandardTePolicy`, which remains the BFF and
PingGateway standard-exchange policy.

The committed PF contract is in
`spiffe/pingfederate/pf-step9-te-policy.json` and
`spiffe/pingfederate/pf-step9-atm-mapping.json`. It requires an access-token
actor, targets `aiDemoPfJwtAtm`, retains the incoming subject's `act`, and
builds a nested actor chain for the PF MCP-service actor. The provisioner adds
`TOKEN_EXCHANGE` to the PF MCP actor client configured in
`demo_api_server/.env`, preserving its `CLIENT_CREDENTIALS` grant, default ATM,
and protected secret.

Preview the local PF changes, then apply and read them back:

```bash
python3 scripts/pingfederate/provision-pf-step9.sh
python3 scripts/pingfederate/provision-pf-step9.sh --apply
```

The script defaults to dry-run. It reads the admin password from the running
PF container unless `PINGFEDERATE_ADMIN_PASSWORD` is supplied, never prints
the password or client secret, and changes only the dedicated Step 9 policy,
its ATM mapping, and the existing MCP actor client.

`demo_api_server/scripts/refresh-service-envs.js` writes PF Step 9 settings
only to `oauth-mcp/.env`, sourcing the actor secret from the vault first and
the existing BFF PF setting as fallback. Restart `oauth-mcp` after refreshing
service environments. The PF request omits `resource` and `audience`; the
dedicated processor-policy mapping selects the Banking API ATM.

## Demo administrator recovery

The local HTML Form adapter uses the simple in-PF credential validator. It does
not support PF's native email/OTP reset flow, so `apply-login-theme.sh` adds a
safe `Forgot password?` link to the login template that opens the demo recovery
page. It never submits PF's unsupported `passwordReset` action.

Provision or reset the local PF `demoadmin` row from the configured credential
with a dry run first:

```bash
export DEMO_ADMIN_PASSWORD='<value from demo_api_server/.env>'
python3 scripts/pingfederate/provision_demo_admin_login.py
python3 scripts/pingfederate/provision_demo_admin_login.py --apply
scripts/pingfederate/apply-login-theme.sh ai-demo-pingfederate
```

Native PF reset remains disabled until a reset-capable validator and notification
publisher are configured.

## AI Agent RAR processor

The PF AI Agent page includes CIMD, third-party ID-JAG exchange, and a custom
`banking_transaction` RAR flow. PF RAR uses a custom SDK processor; it is not
the existing PingOne PAR/Authorize flow. Build the processor against the PF
installation, deploy it, and configure the authorization detail type and
user-attribute mapping before enabling the BFF feature:

```bash
PF_HOME=/path/to/pingfederate scripts/pingfederate/plugins/ai-agent-rar/build.sh
```

See `plugins/ai-agent-rar/README.md` for policy fields, test instructions, and
PF admin-console setup. The processor requires PF 13.1 or newer and the
`transactions:write` scope. It uses only OAuth and JWT.
