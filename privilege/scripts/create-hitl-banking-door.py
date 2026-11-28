#!/usr/bin/env python3
"""Create the `lab-banking-hitl` door family for hitl-mfa-lab-LAB real mode (stage 1: the hold, no PingID).

Per privilege/specs/2026-11-25-hitl-mfa-door.md; names per privilege/NAMING-CONVENTION.md.
The lab's old key (retired tenant ea040334) 401s since the 2026-11-24 tenant move; this rebuilds
the door, permit, key, key-bound grant and hold policy fresh on tenant 5bfb4e12.

Creates (all idempotent — existing names are skipped, not re-created):
  * applications  `lab-banking-hitl` (clone of lab-banking-full, AppType mcp; FrontEndName/EntryPath rewritten; auth none)
  * pacpolicys    `lab-banking-hitl-permit` (clone of lab-banking-full-permit; tools [transfer_funds]; issued to the custodian)
  * agentaccesskeys `lab-banking-hitl-key` (scope mcp, no Provider, custodian aidemo, expiry 2027-02-20)
  * pacpolicys    `lab-banking-hitl-key-grant` (key-bound grant on the door; tools [transfer_funds])
  * aipolicys     `lab-banking-hitl-hold` (forbid mcp:InvokeUnattended on transfer_funds; State Active;
                   @approvers = the HitlApprovers GROUP id — a user id matches nobody (step-20 lesson);
                   transaction grant, ttl 120, request 300 — the lab retries with X-Procyon-Approval-Id inside 90 s)

Backs up nothing it does not change; backs up the templates it clones. The key value is NEVER printed;
it is written to ~/.config/demo-kit/hitl-banking.env (mode 600) as LAB_BANKING_HITL_KEY, and the script
prints the exact HMLAB_REAL_* lines to paste into the lab's .env. Dry run by default; --apply writes.
"""
import base64, copy, datetime, json, os, ssl, sys, time, urllib.request, uuid

HERE = os.path.dirname(os.path.abspath(__file__))
T = os.environ.get("PRIVILEGE_TENANT") or json.load(open(os.path.join(HERE, "..", "state.json")))["env_id"]
BASE = f"https://local.procyon.ai:8643/api/{T}/v1"; CTX = ssl._create_unverified_context()
APPLY = "--apply" in sys.argv
DOOR, PERMIT, HOLD, KEY, GRANT = "lab-banking-hitl", "lab-banking-hitl-permit", "lab-banking-hitl-hold", "lab-banking-hitl-key", "lab-banking-hitl-key-grant"
TOOL = "transfer_funds"
APPROVER_GROUP_DESC, CUSTODIAN = "PingOne Privilege administrators and HITL approvers", "aidemo"  # the group is found by its description prefix (its Name is the PingOne group id)
EXPIRY = "2027-02-20T00:00:00.000Z"
OUT_ENV = os.path.expanduser("~/.config/demo-kit/hitl-banking.env")
BACKUPS = os.path.expanduser("~/.config/demo-kit/backups/hitl-banking-2026-11-25")
b64 = lambda s: base64.b64encode(s.encode()).decode()
ref = lambda kind, name: {"RefKind": kind, "RefID": b64(f"{T}@@@default@@@{name}")}
HDR = {"x-procyon-session-id": str(uuid.uuid4()), "accept": "application/json", "content-type": "application/json"}


def call(m, path, body=None):
    req = urllib.request.Request(f"{BASE}/{path}", method=m, headers=HDR, data=json.dumps(body).encode() if body is not None else None)
    try:
        r = urllib.request.urlopen(req, context=CTX, timeout=110); raw = r.read(); return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:300]


def lst(k):
    c, d = call("GET", f"{k}?ObjectMeta.Namespace=default"); return {o["ObjectMeta"]["Name"]: o for v in d.values() if isinstance(v, list) for o in v}


apps, pols, keys, users, aip = lst("applications"), lst("pacpolicys"), lst("agentaccesskeys"), lst("users"), lst("aipolicys")
uname = {u["Spec"]["UserName"]: n for n, u in users.items()}
if CUSTODIAN not in uname and f"cmuir+{CUSTODIAN}@pingone.com" in uname: uname[CUSTODIAN] = uname[f"cmuir+{CUSTODIAN}@pingone.com"]  # usernames are emails on 5bfb4e12
assert CUSTODIAN in uname, f"user {CUSTODIAN} missing"
cust_id = uname[CUSTODIAN]
_g = [n for n, o in lst("groups").items() if o["Spec"].get("Description", "").startswith(APPROVER_GROUP_DESC)]
assert len(_g) == 1, f"expected exactly one approver group starting '{APPROVER_GROUP_DESC}', found {len(_g)}"
approver_id = _g[0]
assert "lab-banking-full" in apps, "template door lab-banking-full missing"
print(f"tenant {T}\ndoor {DOOR}; approver group {approver_id[:8]}; custodian {CUSTODIAN}={cust_id[:8]}; tool {TOOL}")

now = datetime.datetime.utcnow(); fmt = "%Y-%m-%dT%H:%M:%S.000Z"; nb = (now - datetime.timedelta(minutes=2)).strftime(fmt)
status0 = {"Status": "", "AppRoles": {"ObjectRef": []}, "Error": "", "ApprovalReq": {"RefKind": "", "RefID": ""}}
CT = {"Map": {"purpose": "hitl-mfa-lab", "source": "ai-demo2", "env": "demo"}}
strip = lambda o: [o["ObjectMeta"].pop(k, None) for k in ("UUID", "CreatedAt", "UpdatedAt", "RevisionID")]
plan = []

# 1. door (clone of lab-banking-full, the standing full-tools MCP door; auth none like the lab's bearer-key path)
if DOOR not in apps:
    d = copy.deepcopy(apps["lab-banking-full"]); strip(d)
    d["ObjectMeta"].update({"Name": DOOR, "ID": b64(f"{T}@@@default@@@{DOOR}"), "CTags": CT})
    m = d["Spec"]["McpAppConfig"]
    m["FrontEndName"] = {"Elems": [f"{DOOR}.default.applications.procyon.ai:8643"]}
    m["EntryPath"] = "/mcp"
    m["Backends"] = {"Elems": ["http://mcpdemo-hitl.ping-devops-cmuir.svc.cluster.local"]}  # own backend: transfer_funds is flag-gated there, so the shared mcpdemo (and lab-banking-full) never lists it (2026-11-27)
    d["Spec"]["Description"] = f"HITL MFA lab door: {TOOL} is held for human approval (hold policy {HOLD})."
    plan.append(("applications", DOOR, d))
else:
    print(f"  door {DOOR} already exists (AuthMode {apps[DOOR]['Spec']['McpAppConfig']['AuthMode']})")

# 2. permit (issued to the custodian; the door's own tool list)
if PERMIT not in pols:
    p = copy.deepcopy(pols["lab-banking-full-permit"]); strip(p)
    p["ObjectMeta"].update({"Name": PERMIT, "ID": b64(f"{T}@@@default@@@{PERMIT}"), "CTags": CT})
    p["IssuedTo"] = {"ObjectRef": [ref("User", cust_id)]}
    rule = p["Spec"]["ActionMap"]["MCP"]["PolicyRule"][0]
    rule["ObjectRef"] = ref("Application", DOOR); rule["Attributes"] = {"Map": {}}
    rule["Capabilities"]["Map"]["tools"] = {"Elems": [TOOL]}
    p["Spec"]["Description"] = f"Permit door for the HITL MFA lab: {TOOL} only; the hold policy {HOLD} narrows on top."
    plan.append(("pacpolicys", PERMIT, p))

# 3. agent key (MCP-shaped: scopes ["mcp"], NO Provider — an LLM-shaped key 400s on the door path)
if KEY not in keys:
    tpl = next(k for n, k in keys.items() if k["Spec"].get("Scopes", {}).get("Elems") == ["mcp"] and not k["Spec"].get("Provider") and n in ("meridian-agent", "muse-agent", "agg-guest"))
    k = copy.deepcopy(tpl); strip(k); k["ObjectMeta"].update({"Name": KEY, "ID": b64(f"{T}@@@default@@@{KEY}"), "CTags": CT})
    k["Spec"].update({"VirtualKey": "", "RealKey": "", "Revoked": False, "Scopes": {"Elems": ["mcp"]}, "UserRef": ref("User", cust_id), "NotAfter": EXPIRY})
    if "CustodianRef" in k["Spec"]: k["Spec"]["CustodianRef"] = {"RefKind": "", "RefID": ""}  # template names a NonHumanIdentity; a human custodian is UserRef only
    plan.append(("agentaccesskeys", KEY, k))
else:
    print(f"  key {KEY} already exists")

# 4. key-bound grant
if GRANT not in pols:
    g = copy.deepcopy(pols["lab-banking-full-key-grant"]); strip(g)
    g["ObjectMeta"].update({"Name": GRANT, "ID": b64(f"{T}@@@default@@@{GRANT}"), "CTags": CT})
    g["IssuedTo"] = {"ObjectRef": [ref("User", cust_id)]}
    rule = g["Spec"]["ActionMap"]["MCP"]["PolicyRule"][0]
    rule["ObjectRef"] = ref("Application", DOOR); rule["Attributes"] = {"Map": {"agentaccesskey": b64(f"{T}@@@default@@@{KEY}")}}
    rule["Capabilities"]["Map"]["tools"] = {"Elems": [TOOL]}
    g["Spec"]["ActionMap"]["MCP"]["PolicyRule"] = [rule]
    g["Spec"]["Description"] = f"Key-bound grant for the agent key {KEY} on {DOOR}; the hold policy {HOLD} narrows on top."
    g["NotBefore"], g["NotAfter"], g["Status"] = nb, EXPIRY, status0; g["GivenName"] = GRANT; g["Type"] = g.get("Type") or "App"
    plan.append(("pacpolicys", GRANT, g))

# 5. hold policy (AI policy; State Active or the gateway only shadows it — step-20 lesson)
if HOLD not in aip:
    h = copy.deepcopy(aip["opensearch-hitl2-hold"]); strip(h)
    h["ObjectMeta"].update({"Name": HOLD, "ID": b64(f"{T}@@@default@@@{HOLD}"), "CTags": CT})
    cedar = (f'@grant("transaction")\n@ttl("120")\n@request_ttl("300")\n@approvers("{approver_id}")\n'
             f'@reason("HITL MFA lab: {TOOL} needs a human")\n'
             f'forbid (\n  principal,\n  action == Action::"mcp:InvokeUnattended",\n  resource == Tool::"{TOOL}"\n)\n'
             f'when   {{ context.app == "{DOOR}" }}\n'
             'unless { context has approval_count && context.approval_count >= 1 };\n')
    form = {"flow": "mcp", "stage": "request", "outcome": "hitl", "principalKind": "any", "principalName": "",
            "scopeName": DOOR, "resourceKind": "named", "resourceName": TOOL, "conditions": [],
            "reason": f"HITL MFA lab: {TOOL} needs a human", "grantShape": "transaction", "ttlSec": "120",
            "requestTtlSec": "300", "approvals": "1", "distinctApprovers": False, "approvers": approver_id, "bindToCaller": False}
    h["Spec"].update({"Description": f"HITL MFA lab: hold {TOOL} on {DOOR} for human approval.",
                      "Cedar": cedar, "AuthoringMode": "builder",
                      "BuilderForm": b64(json.dumps(form, separators=(",", ":"))),
                      "TemplateID": "", "TemplateParams": {"Map": {}}, "CandidateExpiresAt": ""})
    h["State"] = "Active"
    plan.append(("aipolicys", HOLD, h))
else:
    h = aip[HOLD]
    print(f"  hold {HOLD} already exists (State {h.get('State')!r})")

for kind, name, _ in plan: print(f"  would create {kind}: {name}")
if not plan: print("  nothing to create")
if not APPLY: print("(dry run)"); sys.exit(0)

os.makedirs(BACKUPS, exist_ok=True)
for src in ("lab-banking-full", "lab-banking-full-permit", "lab-banking-full-key-grant", "opensearch-hitl2-hold"):
    kind = "applications" if src == "lab-banking-full" else ("aipolicys" if src == "opensearch-hitl2-hold" else "pacpolicys")
    obj = apps.get(src) or pols.get(src) or aip.get(src)
    if obj:
        bk = os.path.join(BACKUPS, f"{src}.{time.strftime('%Y%m%d-%H%M%S')}.json")
        open(bk, "w").write(json.dumps(obj, indent=1)); os.chmod(bk, 0o600)
print("templates backed up to", BACKUPS)

for kind, name, body in plan:
    c, r = call("POST", kind, body)
    print(f"POST {kind}/{name}: {c}" + ("" if c in (200, 201) else f" {str(r)[:200]}"))
    if c not in (200, 201): sys.exit(1)
    time.sleep(3)

# read-back (names/states only; never the key value)
a2, k2, g2, h2 = lst("applications"), lst("agentaccesskeys"), lst("pacpolicys"), lst("aipolicys")
ok = DOOR in a2 and k2[KEY]["Spec"].get("VirtualKey") and not k2[KEY]["Spec"].get("Revoked") and GRANT in g2 and h2[HOLD].get("State") == "Active"
print("read-back: door", DOOR in a2, "| key present+live", bool(k2[KEY]["Spec"].get("VirtualKey")) and not k2[KEY]["Spec"].get("Revoked"),
      "| grant", GRANT in g2, "| hold State", h2.get(HOLD, {}).get("State"))
if not ok: sys.exit(1)
if k2[KEY]["Spec"].get("VirtualKey"):
    fd = os.open(OUT_ENV, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f: f.write(f"LAB_BANKING_HITL_KEY={k2[KEY]['Spec']['VirtualKey']}\n")
    print("key written to", OUT_ENV, "(mode 600)")
print(f"""
next (owner or --env flag):
  hitl-mfa-lab-LAB/.env:
    HMLAB_REAL_URL=https://mcpgw-pingid.ai-demo.ping-devops.com/{DOOR}/mcp
    HMLAB_REAL_AGENT_KEY=<the value in {OUT_ENV}>
  then: docker compose up -d   # policy propagation ~4 min before the live call holds
  live check: POST {DOOR}/mcp initialize with the key -> 200; tools/call {TOOL} -> 403 pending_approval + ins_ id
""")
print("done")
