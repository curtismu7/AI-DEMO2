#!/usr/bin/env bash
# scripts/se-capacity-check.sh -- READ-ONLY CPU capacity check for the shared SE EKS cluster.
#
# Prints, per node, allocatable CPU minus the CPU already requested by pods bound to it, the
# number of Pending (unscheduled) pods cluster-wide, and answers one question:
#   "can a pod that requests N millicores be scheduled right now?"
#
# Why: on 2026-10-21 a demo-api-server rollout left the new pod Pending for 5-8 minutes
# ("0/27 nodes available: 26 Insufficient cpu") and SE returned 502 the whole time.
# demo-api-server cannot surge (RWO EBS volumes, see docs/runbooks/se-cpu-rightsizing.md), so the
# only safe move is to look BEFORE the rollout.
#
# Usage:
#   scripts/se-capacity-check.sh                 # N = demo-api-server's total request, read live
#   scripts/se-capacity-check.sh 500             # N = 500 millicores
#   scripts/se-capacity-check.sh --request 500m
#   scripts/se-capacity-check.sh -n ping-devops-cmuir --deploy demo-api-server
#   scripts/se-capacity-check.sh --zone us-east-2b   # only count nodes in that zone
#   scripts/se-capacity-check.sh -q              # only the verdict line
#
# Exit codes:  0 = at least one node can take the pod now
#              1 = no node can (the new pod would sit Pending)
#              2 = could not tell (usage error, kubectl/python3 missing or failing)
#
# Safety: only `kubectl get ... -o json`. No writes, no env/secret reads, no secrets printed.
# Works with bash 3.2 / zsh-invoked-as-bash on macOS. Needs kubectl and python3.
set -uo pipefail

NS="${APP_NS:-ping-devops-cmuir}"
DEPLOY="demo-api-server"
REQ=""
ZONE=""
QUIET=0

usage() { sed -n '2,26p' "$0"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--namespace) NS="${2:?missing namespace}"; shift 2 ;;
    --deploy) DEPLOY="${2:?missing deployment}"; shift 2 ;;
    --request) REQ="${2:?missing millicores}"; shift 2 ;;
    --zone) ZONE="${2:?missing zone}"; shift 2 ;;
    -q|--quiet) QUIET=1; shift ;;
    -h|--help) usage; exit 0 ;;
    [0-9]*) REQ="$1"; shift ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

command -v kubectl >/dev/null 2>&1 || { echo "se-capacity-check: kubectl not found" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "se-capacity-check: python3 not found" >&2; exit 2; }

TMP="$(mktemp -d "${TMPDIR:-/tmp}/se-capacity.XXXXXX")" || exit 2
trap 'rm -rf "$TMP"' EXIT

kubectl get nodes -o json >"$TMP/nodes.json" 2>"$TMP/err" \
  || { echo "se-capacity-check: 'kubectl get nodes' failed: $(head -c 300 "$TMP/err")" >&2; exit 2; }
kubectl get pods -A -o json >"$TMP/pods.json" 2>"$TMP/err" \
  || { echo "se-capacity-check: 'kubectl get pods -A' failed: $(head -c 300 "$TMP/err")" >&2; exit 2; }
# The deployment is optional: with an explicit request and no --zone we do not need it.
if kubectl -n "$NS" get deploy "$DEPLOY" -o json >"$TMP/deploy.json" 2>"$TMP/err"; then
  HAVE_DEPLOY=1
else
  HAVE_DEPLOY=0
  echo '{}' >"$TMP/deploy.json"
fi
# Zone of the deployment's RWO volumes (PV node affinity), best effort: a zone-pinned volume
# means only nodes in that zone count. PVs are cluster-scoped, so this can be denied; then no filter.
echo '{"items":[]}' >"$TMP/pvs.json"; echo '{"items":[]}' >"$TMP/pvcs.json"
if [ "$HAVE_DEPLOY" = 1 ] && [ -z "$ZONE" ]; then
  kubectl -n "$NS" get pvc -o json >"$TMP/pvcs.json" 2>/dev/null || echo '{"items":[]}' >"$TMP/pvcs.json"
  kubectl get pv -o json >"$TMP/pvs.json" 2>/dev/null || echo '{"items":[]}' >"$TMP/pvs.json"
fi

SE_REQ="$REQ" SE_ZONE="$ZONE" SE_QUIET="$QUIET" SE_NS="$NS" SE_DEPLOY="$DEPLOY" SE_HAVE_DEPLOY="$HAVE_DEPLOY" \
SE_DIR="$TMP" python3 -I - <<'PY'
import json, os, sys

d = os.environ["SE_DIR"]
def load(n):
    with open(os.path.join(d, n)) as f:
        return json.load(f)

def milli(v):
    if v is None:
        return 0
    v = str(v)
    if v.endswith("m"):
        return int(float(v[:-1]))
    return int(round(float(v) * 1000))

def pod_request(p):
    spec = p.get("spec", {})
    total = sum(milli(c.get("resources", {}).get("requests", {}).get("cpu")) for c in spec.get("containers", []))
    init = max([milli(c.get("resources", {}).get("requests", {}).get("cpu")) for c in spec.get("initContainers", [])] or [0])
    return max(total, init)

nodes = load("nodes.json").get("items", [])
pods = load("pods.json").get("items", [])
deploy = load("deploy.json")
pvs = load("pvs.json").get("items", [])
pvcs = load("pvcs.json").get("items", [])
quiet = os.environ["SE_QUIET"] == "1"
ns = os.environ["SE_NS"]
dname = os.environ["SE_DEPLOY"]
zone = os.environ["SE_ZONE"]
notes = []

# --- N: explicit, else the deployment's total request ---
req = os.environ["SE_REQ"]
dep_req = None
if deploy.get("spec"):
    dep_req = pod_request({"spec": deploy["spec"]["template"]["spec"]})
if req:
    n_req = int(req) if req.isdigit() else milli(req)  # bare number = millicores here
    src = "given on the command line"
elif dep_req is not None:
    n_req = dep_req
    src = "total request of %s/%s, read live" % (ns, dname)
else:
    print("se-capacity-check: no request given and deployment %s/%s not readable" % (ns, dname), file=sys.stderr)
    sys.exit(2)

# --- zone of the deployment's PVs (RWO volumes pin the pod to one AZ) ---
if not zone and deploy.get("spec"):
    claims = [v["persistentVolumeClaim"]["claimName"]
              for v in deploy["spec"]["template"]["spec"].get("volumes", []) if "persistentVolumeClaim" in v]
    vol = {c["metadata"]["name"]: c.get("spec", {}).get("volumeName") for c in pvcs}
    zones = set()
    for pv in pvs:
        if pv["metadata"]["name"] in [vol.get(c) for c in claims]:
            terms = pv.get("spec", {}).get("nodeAffinity", {}).get("required", {}).get("nodeSelectorTerms", [])
            for t in terms:
                for e in t.get("matchExpressions", []):
                    if e.get("key") in ("topology.kubernetes.io/zone", "failure-domain.beta.kubernetes.io/zone"):
                        zones.update(e.get("values", []))
    if len(zones) == 1:
        zone = next(iter(zones))
        notes.append("only nodes in zone %s count: %s's RWO volumes are pinned there" % (zone, dname))
    elif len(zones) > 1:
        notes.append("%s's volumes span zones %s: no zone can satisfy them, check the PVs" % (dname, sorted(zones)))

# --- per-node numbers ---
requested = {}
pending_unsched = 0
pending_total = 0
for p in pods:
    phase = p.get("status", {}).get("phase")
    if phase in ("Succeeded", "Failed"):
        continue
    node = p.get("spec", {}).get("nodeName")
    if phase == "Pending":
        pending_total += 1
        if not node:
            pending_unsched += 1
    if node:
        requested[node] = requested.get(node, 0) + pod_request(p)

rows = []
for n in nodes:
    name = n["metadata"]["name"]
    labels = n["metadata"].get("labels", {})
    nz = labels.get("topology.kubernetes.io/zone", "")
    alloc = milli(n.get("status", {}).get("allocatable", {}).get("cpu"))
    ready = any(c.get("type") == "Ready" and c.get("status") == "True" for c in n.get("status", {}).get("conditions", []))
    cordoned = bool(n.get("spec", {}).get("unschedulable"))
    taints = [t for t in n.get("spec", {}).get("taints", []) if t.get("effect") in ("NoSchedule", "NoExecute")]
    used = requested.get(name, 0)
    usable = ready and not cordoned and not taints
    in_zone = (not zone) or nz == zone
    rows.append(dict(name=name, zone=nz, alloc=alloc, used=used, free=alloc - used,
                     usable=usable, in_zone=in_zone, ready=ready, cordoned=cordoned, tainted=bool(taints)))

cand = [r for r in rows if r["usable"] and r["in_zone"]]
best = max(cand, key=lambda r: r["free"]) if cand else None
fits = [r for r in cand if r["free"] >= n_req]

# --- old pod's slot (deployment pods currently running): what a no-surge rollout gives back ---
slot = None
if deploy.get("spec"):
    sel = deploy["spec"].get("selector", {}).get("matchLabels", {})
    ns_pods = [p for p in pods if p["metadata"].get("namespace") == ns
               and p.get("status", {}).get("phase") in ("Running", "Pending")
               and all(p["metadata"].get("labels", {}).get(k) == v for k, v in sel.items())
               and p.get("spec", {}).get("nodeName")]
    best_after = None
    for p in ns_pods:
        r = next((x for x in rows if x["name"] == p["spec"]["nodeName"]), None)
        if r and r["usable"]:
            after = r["free"] + pod_request(p)
            if best_after is None or after > best_after[1]:
                best_after = (r["name"], after)
    slot = best_after

if not quiet:
    print("SE cluster CPU capacity (requests vs allocatable; read-only)")
    print("%-46s %-11s %9s %9s %9s  %s" % ("node", "zone", "alloc(m)", "req(m)", "free(m)", "flags"))
    for r in sorted(rows, key=lambda r: -r["free"]):
        flags = []
        if not r["ready"]: flags.append("NotReady")
        if r["cordoned"]: flags.append("cordoned")
        if r["tainted"]: flags.append("tainted")
        if zone and not r["in_zone"]: flags.append("other-zone")
        if r in fits: flags.append("FITS")
        print("%-46s %-11s %9d %9d %9d  %s" % (r["name"][:46], r["zone"][:11], r["alloc"], r["used"], r["free"], ",".join(flags)))
    tot_alloc = sum(r["alloc"] for r in rows); tot_used = sum(r["used"] for r in rows)
    print("nodes: %d   allocatable: %dm   requested: %dm (%.0f%%)   free: %dm" %
          (len(rows), tot_alloc, tot_used, 100.0 * tot_used / tot_alloc if tot_alloc else 0, tot_alloc - tot_used))
    print("Pending pods cluster-wide: %d (of which unscheduled, no node assigned yet: %d)" % (pending_total, pending_unsched))
    for n_ in notes:
        print("note: " + n_)
    if slot:
        print("old %s pod's node %s would have %dm free once the old pod is gone (a no-surge rollout returns its slot%s)"
              % (dname, slot[0], slot[1], "; fits" if slot[1] >= n_req else "; still too small"))

if fits:
    print("OK: a pod requesting %dm (%s) CAN be scheduled now: %d node(s) fit, most free %dm on %s" %
          (n_req, src, len(fits), best["free"], best["name"]))
    sys.exit(0)
msg = "WARNING: a pod requesting %dm (%s) can NOT be scheduled now: " % (n_req, src)
if best:
    msg += "the most free CPU on any usable node%s is %dm (%s)" % (" in " + zone if zone else "", best["free"], best["name"])
else:
    msg += "no usable node%s" % (" in zone " + zone if zone else "")
if pending_unsched:
    msg += "; %d pod(s) already Pending cluster-wide" % pending_unsched
print(msg)
if slot and slot[1] >= n_req:
    print("         It would only fit in the old pod's own slot on %s (%dm free once it terminates); another team's pod can take that slot first." % (slot[0], slot[1]))
sys.exit(1)
PY
