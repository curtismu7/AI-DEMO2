# Proxy enrollment, Docker startup, and token renewal

Referenced from SKILL.md.

The proxy needs a one-time enrollment token on first boot. After that it persists
state in `/procyon/ssl/` (mainly `proxy-config.data`).

### Get a token
1. Privilege Cloud console → Gateways → your gateway → "Add Node"
2. Copy the JWT — it expires in ~24h

### Provide to Docker

**Option A — env var (preferred for first boot):**
```bash
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
```
docker-compose.yml passes it via `ENV_PROXY_TOKEN: "${PRIVILEGE_PROXY_TOKEN:-}"`.

**Option B — token file. It is an ENV FILE, not a bare JWT:**
```bash
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env
./run-docker.sh optional start mcpgw
```
Compose loads it with `env_file`, so the `ENV_PROXY_TOKEN=` prefix is required and
there is no `export`/`cat` step. Writing a bare JWT (what earlier revisions of this
skill said) produces a file whose only "variable" is the JWT itself, and the proxy
starts with no token at all. Do not add a single-file bind of it either: cyonproxy
rewrites `/procyon/ssl/proxy-token.data` at startup (same token, rewritten — not
swapped for a long-lived one), so a `:ro` bind makes the container exit 1 with
*"ProxyToken write to /procyon/ssl/proxy-token.data failed … read-only file
system"*, and a `:rw` single-file bind breaks as soon as the proxy replaces rather
than truncates the file.

⚠️ **`run-docker.sh` warns about the wrong path.** It probes
`ping-mcpgw/config/proxy-token` (the pre-move location) and prints *"Set
PRIVILEGE_PROXY_TOKEN env or create …"* even when the real
`ping-mcpgw/procyon/config/proxy-token.env` exists and `.env` already carries the
token. It starts the profile anyway — the warning is cosmetic. Verified 2026-08-11
at `run-docker.sh:1206`.

### After enrollment
The proxy writes `proxy-config.data` into the `mcpgw-ssl` Docker volume.
Subsequent boots use this persisted config — no token needed. If the volume is
lost (Docker crash, prune), re-enroll with a fresh token.

### Re-enrollment (Docker crash recovery)
```bash
# 1. Get new token from console
# 2. Save it (env-file format — the ENV_PROXY_TOKEN= prefix is required):
printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...' > ping-mcpgw/procyon/config/proxy-token.env
# 3. Clear stale volume state:
docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
# 4. Start fresh:
export PRIVILEGE_PROXY_TOKEN="eyJ..."
./run-docker.sh optional start mcpgw
# 5. Verify enrollment:
docker logs ai-demo-ping-mcpgw 2>&1 | grep -i "enrolled\|connected\|ready"
```


## Docker startup

```bash
# Local dev (compose optional group):
./run-docker.sh optional start mcpgw

# Standalone (host network; --net=host itself was proven on the previous binary,
# not re-verified on mcpgw):
docker run -d --name ai-demo-ping-mcpgw \
  --net=host \
  --env-file ping-mcpgw/procyon/config/proxy-token.env \
  -v ./ping-mcpgw/procyon:/var/lib/procyon \
  public.ecr.aws/s7q1z8z4/privilege-mcpgw@sha256:0faad5903a5bd72539b1df525e3c7bc5d458a5bd324aac9755b8af99dfa6647d \
  /procyon/bin/mcpgw -hostname local.ping-devops.com -mcpconfpath /var/lib/procyon/config/pingone.env
```

Never drive `docker compose up` directly — a hook blocks it. Parallel sessions
converging the same project produce `container name /ai-demo-... is already in use`
conflicts. Use `./run-docker.sh`, which pins the project name/directory.

## Token expiration and renewal

The enrollment token (`ENV_PROXY_TOKEN`) is a JWT issued by the Privilege console
wizard. It typically expires **~24h after creation** (first enrollment) or **~1 year**
for long-lived node tokens.

### Check expiration
```bash
sed 's/^ENV_PROXY_TOKEN=//' ping-mcpgw/procyon/config/proxy-token.env | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "
import sys, json, datetime
d = json.loads(sys.stdin.read())
exp = datetime.datetime.fromtimestamp(d['exp'], tz=datetime.timezone.utc)
now = datetime.datetime.now(tz=datetime.timezone.utc)
status = 'EXPIRED' if now > exp else 'valid'
print(f'{status} — expires {exp.isoformat()} ({"%.1f" % ((exp-now).total_seconds()/3600)}h from now)')
"
```

### Renew an expired token
1. PingOne Privilege console → **Cloud > Gateways** → select your gateway
2. Click **Add Node** (or the refresh icon on an existing node row)
3. Copy the new `ENV_PROXY_TOKEN=eyJ...` JWT
4. Save locally — env-file format, the prefix is required:
   ```bash
   printf 'ENV_PROXY_TOKEN=%s\n' 'eyJ...<full JWT>' > ping-mcpgw/procyon/config/proxy-token.env
   ```
5. Clear stale enrollment state and restart:
   ```bash
   docker volume rm ai-demo_mcpgw-ssl 2>/dev/null || true
   ./run-docker.sh optional start mcpgw
   ```
6. Verify:
   ```bash
   docker logs ai-demo-ping-mcpgw 2>&1 | grep -iE "enrolled|connected|ready|error"
   ```

### After successful enrollment
Once enrolled, the proxy persists its identity in the `mcpgw-ssl` Docker volume
(`/procyon/ssl/proxy-config.data`). Subsequent container restarts do NOT need the
token — the volume state is sufficient. Only clear the volume if re-enrolling.