#!/usr/bin/env python3
"""Apply or check the PingOne user gate on PingFederate's standard exchange policy.

The contract is spiffe/pingfederate/pf-pingone-user-gate.json. With it applied,
every RFC 8693 exchange through aiDemoStandardTePolicy looks up the PingOne
account that has the subject's username and is refused unless that account is
enabled and its mayAct names the AI agent actor. Granting, revoking and
disabling therefore happen in PingOne, for both login providers.

Dry-run is the default and changes nothing.

  (no flag)   show what --apply would change
  --apply     create/update the data store, add the lookup and criteria, read back
  --check     exit 1 if live PingFederate differs from the contract (no changes)
  --remove    take the lookup and criteria off the policy (the data store stays)

Only this gate's own attribute source and criteria are touched; anything else on
the policy is preserved. No secret or PingFederate response body is printed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "spiffe" / "pingfederate" / "pf-pingone-user-gate.json"
PF_API_BASE = os.environ.get("PF_BASE", "https://127.0.0.1:9999/pf-admin-api/v1").rstrip("/")
POLICIES = "/oauth/tokenExchange/processor/policies"


def get_password() -> str:
    configured = os.environ.get("PINGFEDERATE_ADMIN_PASSWORD")
    if configured:
        return configured
    try:
        return subprocess.check_output(
            ["docker", "exec", "ai-demo-pingfederate", "sh", "-lc", 'printf %s "$PING_IDENTITY_PASSWORD"'],
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("Set PINGFEDERATE_ADMIN_PASSWORD or start ai-demo-pingfederate") from exc


def load_env() -> dict[str, str]:
    """demo_api_server/.env from this checkout, else from the main worktree (a
    linked worktree carries no gitignored files). Process env wins."""
    candidates = [ROOT / "demo_api_server" / ".env"]
    try:
        listing = subprocess.check_output(["git", "worktree", "list", "--porcelain"], cwd=ROOT, text=True)
        first = next((line for line in listing.splitlines() if line.startswith("worktree ")), None)
        if first:
            candidates.append(Path(first.split(" ", 1)[1]) / "demo_api_server" / ".env")
    except (OSError, subprocess.CalledProcessError):
        pass
    values: dict[str, str] = {}
    for path in candidates:
        if path.is_file():
            for line in path.read_text().splitlines():
                if "=" in line and not line.lstrip().startswith("#"):
                    key, _, value = line.partition("=")
                    values[key.strip()] = value.strip().strip("\"'")
            break
    values.update({k: v for k, v in os.environ.items() if v})
    values.setdefault("PINGONE_REGION", "com")
    return values


def expand(template: str, env: dict[str, str]) -> str:
    out = template
    for key in ("PINGONE_REGION", "PINGONE_ENVIRONMENT_ID"):
        if "${" + key + "}" in out:
            if not env.get(key):
                raise RuntimeError(f"{key} is not set; cannot resolve the contract")
            out = out.replace("${" + key + "}", env[key])
    return out


def api(method: str, path: str, auth: str, payload: Any | None = None) -> tuple[int, Any | None]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{PF_API_BASE}{path}", data=data, method=method,
        headers={"Authorization": auth, "X-XSRF-Header": "x", "Accept": "application/json",
                 "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, context=ssl._create_unverified_context(), timeout=30) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        # Never print the body: data store and client representations carry
        # PingFederate's encrypted secret fields.
        return exc.code, None
    except (OSError, TimeoutError) as exc:
        raise RuntimeError(f"PF Admin API {method} {path} failed: {exc}") from exc


def field(name: str, value: str) -> dict[str, str]:
    return {"name": name, "value": value}


def desired_data_store(contract: dict[str, Any], env: dict[str, str]) -> dict[str, Any]:
    ds = contract["dataStore"]
    client_id, secret = env.get(ds["clientIdEnv"]), env.get(ds["clientSecretEnv"])
    if not client_id or not secret:
        raise RuntimeError(f"{ds['clientIdEnv']} / {ds['clientSecretEnv']} are not set; refusing to modify PingFederate")
    base = expand(ds["baseUrl"], env)
    return {
        "type": "CUSTOM", "id": ds["id"], "name": ds["name"],
        "pluginDescriptorRef": {"id": ds["plugin"]},
        "configuration": {
            "tables": [
                {"name": "Base URLs and Tags",
                 "rows": [{"fields": [field("Base URL", base), field("Tags", "")], "defaultRow": True}]},
                {"name": "HTTP Request Headers", "rows": []},
                {"name": "Attributes",
                 "rows": [{"fields": [field("Local Attribute", name), field("JSON Response Attribute Path", pointer)]}
                          for name, pointer in ds["attributes"].items()]},
            ],
            "fields": [
                field("Authentication Method", "OAuth 2.0 Bearer Token"), field("HTTP Method", "GET"),
                field("OAuth Authentication Method", "Client Credentials"),
                field("OAuth Token Endpoint", expand(ds["tokenEndpoint"], env)),
                field("Client ID", client_id), field("Client Secret", secret),
                field("Enable HTTPS Hostname Verification", "true"),
                field("Read Timeout (ms)", "10000"), field("Connection Timeout (ms)", "10000"),
                field("Max Payload Size (KB)", "1024"), field("Retry Request", "true"),
                field("Maximum Retries Limit", "2"), field("Retry Error Codes", "429"),
                field("Maximum Connections", "32"),
            ],
        },
    }


def data_store_facts(store: dict[str, Any]) -> dict[str, Any]:
    """The non-secret settings the contract pins, read off a data store body."""
    config = store.get("configuration") or {}
    fields = {f.get("name"): f.get("value") for f in config.get("fields", [])}
    tables = {t.get("name"): t.get("rows", []) for t in config.get("tables", [])}

    def row(r: dict[str, Any]) -> dict[str, str]:
        return {f.get("name"): f.get("value") for f in r.get("fields", [])}

    bases = [row(r).get("Base URL") for r in tables.get("Base URLs and Tags", [])]
    attributes = {row(r).get("Local Attribute"): row(r).get("JSON Response Attribute Path")
                  for r in tables.get("Attributes", [])}
    return {
        "plugin": (store.get("pluginDescriptorRef") or {}).get("id"),
        "baseUrl": bases[0] if bases else None,
        "tokenEndpoint": fields.get("OAuth Token Endpoint"),
        "clientId": fields.get("Client ID"),
        "authentication": fields.get("Authentication Method"),
        "attributes": attributes,
    }


def gate_source(contract: dict[str, Any]) -> dict[str, Any]:
    source = contract["attributeSource"]
    return {
        "type": "CUSTOM", "id": source["id"], "description": source["description"],
        "dataStoreRef": {"id": contract["dataStore"]["id"]},
        "filterFields": [{"name": "Resource Path", "value": source["resourcePath"]}],
    }


def gate_criteria(contract: dict[str, Any], env: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for item in contract["criteria"]:
        value = item.get("value")
        if value is None:
            value = env.get(item["valueEnv"])
            if not value:
                raise RuntimeError(f"{item['valueEnv']} is not set; cannot resolve the contract")
        out.append({
            "source": {"type": "CUSTOM_DATA_STORE", "id": contract["attributeSource"]["id"]},
            "attributeName": item["attributeName"], "condition": item["condition"],
            "value": value, "errorResult": item["errorResult"],
        })
    return out


def mapping_gate(mapping: dict[str, Any], source_id: str) -> dict[str, Any]:
    """This gate's footprint on one processor mapping, normalised for comparison."""
    sources = [s for s in mapping.get("attributeSources", []) if s.get("id") == source_id]
    criteria = [c for c in (mapping.get("issuanceCriteria") or {}).get("conditionalCriteria", [])
                if (c.get("source") or {}).get("id") == source_id]
    return {
        "source": [{
            "dataStore": (s.get("dataStoreRef") or {}).get("id"),
            "resourcePath": next((f.get("value") for f in s.get("filterFields", [])
                                  if f.get("name") == "Resource Path"), None),
        } for s in sources],
        "criteria": [{k: c.get(k) for k in ("attributeName", "condition", "value", "errorResult")} for c in criteria],
    }


def with_gate(policy: dict[str, Any], contract: dict[str, Any], env: dict[str, str], present: bool) -> dict[str, Any]:
    source_id = contract["attributeSource"]["id"]
    out = json.loads(json.dumps(policy))
    for mapping in out.get("processorMappings", []):
        if mapping.get("subjectTokenType") not in contract["subjectTokenTypes"]:
            continue
        others = [s for s in mapping.get("attributeSources", []) if s.get("id") != source_id]
        kept = [c for c in (mapping.get("issuanceCriteria") or {}).get("conditionalCriteria", [])
                if (c.get("source") or {}).get("id") != source_id]
        criteria = dict(mapping.get("issuanceCriteria") or {})
        if present:
            mapping["attributeSources"] = others + [gate_source(contract)]
            criteria["conditionalCriteria"] = kept + gate_criteria(contract, env)
        else:
            mapping["attributeSources"] = others
            criteria["conditionalCriteria"] = kept
        mapping["issuanceCriteria"] = criteria
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--check", action="store_true")
    mode.add_argument("--remove", action="store_true")
    args = parser.parse_args()

    contract = json.loads(CONTRACT_PATH.read_text())
    env = load_env()
    auth = "Basic " + base64.b64encode(f"administrator:{get_password()}".encode()).decode()
    source_id = contract["attributeSource"]["id"]
    policy_path = f"{POLICIES}/{urllib.parse.quote(contract['policyId'], safe='')}"
    store_path = f"/dataStores/{urllib.parse.quote(contract['dataStore']['id'], safe='')}"
    drift: list[str] = []

    # Data store
    wanted_store = desired_data_store(contract, env)
    status, store = api("GET", store_path, auth)
    if status == 404:
        drift.append("data store is missing")
        print(f"CREATE data store {contract['dataStore']['id']}")
        if args.apply:
            result, _ = api("POST", "/dataStores", auth, wanted_store)
            if result not in (200, 201):
                raise RuntimeError(f"PF Admin API POST /dataStores returned HTTP {result}")
    elif status == 200 and isinstance(store, dict):
        have, want = data_store_facts(store), data_store_facts(wanted_store)
        changed = sorted(key for key in want if have.get(key) != want[key])
        if changed:
            drift.append(f"data store differs: {', '.join(changed)}")
            print(f"UPDATE data store {contract['dataStore']['id']} ({', '.join(changed)})")
            if args.apply:
                result, _ = api("PUT", store_path, auth, wanted_store)
                if result != 200:
                    raise RuntimeError(f"PF Admin API PUT {store_path} returned HTTP {result}")
        else:
            print("OK data store matches the contract (the stored secret cannot be compared)")
    else:
        raise RuntimeError(f"PF Admin API GET {store_path} returned HTTP {status}")

    # Policy
    status, policy = api("GET", policy_path, auth)
    if status != 200 or not isinstance(policy, dict):
        raise RuntimeError(f"PF Admin API GET {policy_path} returned HTTP {status}")
    wanted_policy = with_gate(policy, contract, env, present=not args.remove)
    wanted_gate = {
        "source": [{"dataStore": contract["dataStore"]["id"], "resourcePath": contract["attributeSource"]["resourcePath"]}],
        "criteria": [{k: c.get(k) for k in ("attributeName", "condition", "value", "errorResult")}
                     for c in gate_criteria(contract, env)],
    }
    nothing = {"source": [], "criteria": []}

    def expected(mapping: dict[str, Any]) -> dict[str, Any]:
        return wanted_gate if mapping.get("subjectTokenType") in contract["subjectTokenTypes"] else nothing

    for index, mapping in enumerate(policy.get("processorMappings", [])):
        have = mapping_gate(mapping, source_id)
        label = f"mapping {index + 1} ({mapping.get('subjectTokenType', '?').rsplit(':', 1)[-1]})"
        if expected(mapping) == nothing and have == nothing:
            print(f"-- {label} is not gated, by contract")
        elif args.remove:
            if have["source"] or have["criteria"]:
                print(f"REMOVE gate from {label}")
        elif have != expected(mapping):
            drift.append(f"{label} does not carry the gate" if not have["source"] else f"{label} gate differs")
            print(f"{'ADD' if not have['source'] else 'UPDATE'} gate on {label}")
        else:
            print(f"OK gate present on {label}")

    if args.check:
        if drift:
            print("DRIFT: " + "; ".join(drift))
            return 1
        print("OK live PingFederate matches spiffe/pingfederate/pf-pingone-user-gate.json")
        return 0

    if not (args.apply or args.remove):
        print("Dry-run only. Pass --apply to change PingFederate.")
        return 0

    if wanted_policy != policy:
        result, _ = api("PUT", policy_path, auth, wanted_policy)
        if result != 200:
            raise RuntimeError(f"PF Admin API PUT {policy_path} returned HTTP {result}")

    # Read back rather than trust the write.
    status, after = api("GET", policy_path, auth)
    if status != 200 or not isinstance(after, dict):
        raise RuntimeError(f"PF readback: GET {policy_path} returned HTTP {status}")
    for index, mapping in enumerate(after.get("processorMappings", [])):
        have = mapping_gate(mapping, source_id)
        if args.remove and (have["source"] or have["criteria"]):
            raise RuntimeError(f"PF readback: mapping {index + 1} still carries the gate")
        if args.apply and have != expected(mapping):
            raise RuntimeError(f"PF readback: mapping {index + 1} does not match the contract")
    print("PF readback OK — gate " + ("removed" if args.remove else "applied") + f" on {contract['policyId']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(f"ERROR {exc}", file=sys.stderr)
        sys.exit(2)
