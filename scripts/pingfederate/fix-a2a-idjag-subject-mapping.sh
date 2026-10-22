#!/usr/bin/env bash
# fix-a2a-idjag-subject-mapping.sh — A2A Exchange #2 under PingFederate minted its final token with NO `sub`.
#
# Exchange #2's subject is the id-jag from Exchange #1. aiDemoStandardTePolicy's id-jag processorMapping took
# `subject` from the subject token's `Username` attribute; an id-jag carries `sub` (its TOKEN_SUBJECT), not
# `Username`, so subject came out empty and the gateway's PDP denied every specialist call `missing_sub`
# (the group-policy board hid it: it takes the user from the session, not the token).
#
# Idempotent: ensures the id-jag processorMapping exists (cloned from the access_token one) and maps
# subject <- SUBJECT_TOKEN `sub`. Writes a backup of the policy next to the script's temp dir. Local PF only.
set -euo pipefail

PF_BASE="${PF_BASE:-https://local.ping-devops.com:9999/pf-admin-api/v1}"
POLICY="${POLICY:-aiDemoStandardTePolicy}"
if [[ -z "${PINGFEDERATE_ADMIN_PASSWORD:-}" ]]; then
  PINGFEDERATE_ADMIN_PASSWORD=$(docker inspect ai-demo-pingfederate \
    --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | awk -F= '$1=="PING_IDENTITY_PASSWORD"{print substr($0, index($0,"=")+1)}')
fi
AUTH="administrator:${PINGFEDERATE_ADMIN_PASSWORD}"
TMP="${TMPDIR:-/tmp}/pf-idjag-subject-$$"; mkdir -p "$TMP"
api() { curl -sk -u "$AUTH" -H "X-XSRF-Header: x" "$@"; }

api "$PF_BASE/oauth/tokenExchange/processor/policies/$POLICY" > "$TMP/policy.json"
cp "$TMP/policy.json" "$TMP/policy.backup.json"

python3 - "$TMP" <<'PY'
import copy, json, sys
tmp = sys.argv[1]
IDJAG = 'urn:ietf:params:oauth:token-type:id-jag'
d = json.load(open(f'{tmp}/policy.json'))
maps = d['processorMappings']
m = next((x for x in maps if x.get('subjectTokenType') == IDJAG), None)
if m is None:
    base = next(x for x in maps if x.get('subjectTokenType', '').endswith(':access_token'))
    m = copy.deepcopy(base); m['subjectTokenType'] = IDJAG; maps.append(m)
    print('added id-jag processorMapping')
subj = m['attributeContractFulfillment']['subject']
if subj.get('source', {}).get('type') == 'SUBJECT_TOKEN' and subj.get('value') == 'sub':
    print('already maps subject <- sub'); open(f'{tmp}/unchanged', 'w').close()
else:
    subj['source'] = {'type': 'SUBJECT_TOKEN'}; subj['value'] = 'sub'
    print('set subject <- SUBJECT_TOKEN sub')
json.dump(d, open(f'{tmp}/policy.new.json', 'w'))
PY

if [[ -f "$TMP/unchanged" ]]; then echo "nothing to do (backup: $TMP/policy.backup.json)"; exit 0; fi
code=$(api -o "$TMP/resp.json" -w '%{http_code}' -H "Content-Type: application/json" -X PUT -d @"$TMP/policy.new.json" "$PF_BASE/oauth/tokenExchange/processor/policies/$POLICY")
echo "PUT $POLICY -> HTTP $code (backup: $TMP/policy.backup.json)"
[[ "$code" == "200" ]] || { head -c 400 "$TMP/resp.json"; echo; exit 1; }
