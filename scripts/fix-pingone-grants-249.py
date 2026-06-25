import os, urllib.request, urllib.parse, json, base64, ssl

# Resolve the BFF .env relative to the repo root (this script lives in scripts/).
# Override with ENV_FILE=/path/to/.env if needed.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_ENV_FILE = os.environ.get('ENV_FILE', os.path.join(_REPO_ROOT, 'demo_api_server', '.env'))

env = {}
with open(_ENV_FILE) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, _, v = line.partition('=')
        v = v.strip().strip('"')
        env[k.strip()] = v

ENV_ID  = env['PINGONE_ENVIRONMENT_ID']
# Canonical key names are PINGONE_WORKER_CLIENT_ID/SECRET; fall back to the
# older PINGONE_WORKER_TOKEN_CLIENT_* names if that's what the .env uses.
WC_ID   = env.get('PINGONE_WORKER_CLIENT_ID')     or env['PINGONE_WORKER_TOKEN_CLIENT_ID']
WC_SEC  = env.get('PINGONE_WORKER_CLIENT_SECRET') or env['PINGONE_WORKER_TOKEN_CLIENT_SECRET']
API     = f'https://api.pingone.com/v1/environments/{ENV_ID}'
TURL    = f'https://auth.pingone.com/{ENV_ID}/as/token'
ctx     = ssl.create_default_context()

AI_AGENT  = '2533a614-fcb6-4ab9-82cc-9ab407f1dbda'
MCP_EXC   = '6380065f-f328-41c2-81ed-1daeec811285'

def http(url, method='GET', data=None, headers=None):
    h = headers or {}
    body = None
    if data is not None:
        if isinstance(data, str):
            body = data.encode()
        else:
            body = json.dumps(data).encode()
            h.setdefault('Content-Type', 'application/json')
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, context=ctx) as r:
            raw = r.read()
            return r.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read()
        return e.code, json.loads(raw) if raw else {}

# Worker token
creds = base64.b64encode(f'{WC_ID}:{WC_SEC}'.encode()).decode()
st, body = http(TURL, 'POST', f'grant_type=client_credentials',
                {'Authorization': f'Basic {creds}', 'Content-Type': 'application/x-www-form-urlencoded'})
TOKEN = body['access_token']
H = {'Authorization': f'Bearer {TOKEN}'}
print(f'Worker token OK (status={st})')

# Fetch resources + scopes
st, rd = http(f'{API}/resources?limit=100', headers=H)
resources = (rd.get('_embedded') or {}).get('resources') or rd.get('resources', [])
resByAud = {}
scopeMap = {}  # resId -> {name -> id}
for r in resources:
    if r.get('audience'):
        resByAud[r['audience']] = r
    st2, sd = http(f'{API}/resources/{r["id"]}/scopes?limit=100', headers=H)
    scopes = (sd.get('_embedded') or {}).get('scopes') or sd.get('scopes', [])
    scopeMap[r['id']] = {s['name']: s['id'] for s in scopes}

def get_grants(app_id):
    st, gd = http(f'{API}/applications/{app_id}/grants', headers=H)
    return (gd.get('_embedded') or {}).get('grants') or gd.get('grants', [])

def del_grant(app_id, grant_id, label):
    st, _ = http(f'{API}/applications/{app_id}/grants/{grant_id}', 'DELETE', headers=H)
    ok = st in (200, 202, 204)
    print(f'  {"OK" if ok else "FAIL"} DELETE {label} -> {st}')
    return ok

def create_grant(app_id, audience, scope_names, label):
    r = resByAud.get(audience)
    if not r:
        print(f'  SKIP No resource for {audience}')
        return
    sm = scopeMap.get(r['id'], {})
    scopes = [{'id': sm[n]} for n in scope_names if n in sm]
    missing = [n for n in scope_names if n not in sm]
    if missing:
        print(f'  WARN Scopes missing on {audience}: {missing}')
    if not scopes:
        print(f'  SKIP No valid scopes for {label}')
        return
    st, resp = http(f'{API}/applications/{app_id}/grants', 'POST',
                    {'resource': {'id': r['id']}, 'scopes': scopes}, H)
    ok = st in (200, 201)
    detail = '' if ok else f' -- {resp}'
    print(f'  {"OK" if ok else "FAIL"} POST {label} scopes=[{",".join(scope_names)}] -> {st}{detail}')

# ── AI Agent App ──────────────────────────────────────────────────────────────
print('\n=== AI Agent App (2533a614) ===')
ag_grants = get_grants(AI_AGENT)

# Collect scope names already granted
granted_names = set()
for g in ag_grants:
    rid = (g.get('resource') or g.get('resourceServer') or {}).get('id')
    for sc in g.get('scopes', []):
        sm = scopeMap.get(rid, {})
        for n, sid in sm.items():
            if sid == sc['id']:
                granted_names.add(n)
print(f'  Already granted names: {sorted(granted_names)}')

# Remove any existing agent-gateway grant
for g in ag_grants:
    rid = (g.get('resource') or g.get('resourceServer') or {}).get('id')
    r = next((x for x in resources if x['id'] == rid), None)
    if r and r.get('audience') == 'https://agent-gateway.pingdemo.com':
        del_grant(AI_AGENT, g['id'], 'agent-gateway (existing)')

# Find scopes on agent-gateway NOT already granted elsewhere
agw = resByAud.get('https://agent-gateway.pingdemo.com')
agw_scopes = list(scopeMap.get(agw['id'], {}).keys()) if agw else []
unique = [n for n in agw_scopes if n not in granted_names]
print(f'  agent-gateway scopes not yet granted: {unique}')
if unique:
    create_grant(AI_AGENT, 'https://agent-gateway.pingdemo.com', unique, 'agent-gateway')
else:
    print('  WARN All agent-gateway scopes already granted elsewhere')

# ── MCP Token Exchanger ───────────────────────────────────────────────────────
print('\n=== MCP Token Exchanger (6380065f) ===')
exc_grants = get_grants(MCP_EXC)

exc_granted_names = set()
for g in exc_grants:
    rid = (g.get('resource') or g.get('resourceServer') or {}).get('id')
    for sc in g.get('scopes', []):
        sm = scopeMap.get(rid, {})
        for n, sid in sm.items():
            if sid == sc['id']:
                exc_granted_names.add(n)
print(f'  Currently granted names: {sorted(exc_granted_names)}')

# Delete mcp-gateway grant (recreate with banking:mcp:invoke)
for g in exc_grants:
    rid = (g.get('resource') or g.get('resourceServer') or {}).get('id')
    r = next((x for x in resources if x['id'] == rid), None)
    if r and r.get('audience') == 'https://mcp-gateway.pingdemo.com':
        del_grant(MCP_EXC, g['id'], 'mcp-gateway (delete to recreate)')

# Recreate mcp-gateway with banking:mcp:invoke
create_grant(MCP_EXC, 'https://mcp-gateway.pingdemo.com',
             ['banking:mcp:invoke', 'banking:read', 'banking:write'], 'mcp-gateway')

# mcp-server: find scopes not conflicting with new mcp-gateway grant
mcp_gw_names = {'banking:mcp:invoke', 'banking:read', 'banking:write'}
svr = resByAud.get('https://mcp-server.pingdemo.com')
svr_scopes = list(scopeMap.get(svr['id'], {}).keys()) if svr else []
svr_unique = [n for n in svr_scopes if n not in mcp_gw_names and n not in ('openid',)]
print(f'  mcp-server scopes unique vs mcp-gateway grant: {svr_unique}')
if svr_unique:
    create_grant(MCP_EXC, 'https://mcp-server.pingdemo.com', svr_unique, 'mcp-server')
else:
    print('  WARN mcp-server has no unique scope names -- cannot add without PingOne resource rename')

# ── Final state ───────────────────────────────────────────────────────────────
print('\n=== Final Grants ===')
for app_id, label in [(AI_AGENT, 'AI Agent App'), (MCP_EXC, 'MCP Exchanger')]:
    fg = get_grants(app_id)
    print(f'{label}:')
    for g in fg:
        rid = (g.get('resource') or g.get('resourceServer') or {}).get('id')
        r = next((x for x in resources if x['id'] == rid), None)
        aud = (r or {}).get('audience') or rid
        sm = scopeMap.get(rid, {})
        names = [n for sc in g.get('scopes', []) for n, sid in sm.items() if sid == sc['id']]
        print(f'  OK {aud}: {", ".join(sorted(names))}')
