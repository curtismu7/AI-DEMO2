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
