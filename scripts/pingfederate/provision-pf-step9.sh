#!/usr/bin/env python3
"""Provision the local PF-specific Banking API Step 9 exchange contract.

Dry-run is the default. Pass --apply to create/update only the dedicated
Step 9 policy, ATM mapping, and existing PF MCP actor client. The existing
aiDemoStandardTePolicy and its mapping are never changed.
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
PF_API_BASE = os.environ.get(
    "PF_BASE", "https://127.0.0.1:9999/pf-admin-api/v1"
).rstrip("/")
PF_LINK_BASE = "https://localhost:9999/pf-admin-api/v1"
POLICY_ID = "aiDemoPfStep9TePolicy"
ATM_ID = "aiDemoPfJwtAtm"
ACTOR_CLIENT_ID = "ai-demo-pf-standard-mcp-actor"


def resource_link(path: str, identity: str) -> dict[str, str]:
    return {"id": identity, "location": f"{PF_LINK_BASE}{path}/{identity}"}


def get_password() -> str:
    configured = os.environ.get("PINGFEDERATE_ADMIN_PASSWORD")
    if configured:
        return configured
    try:
        return subprocess.check_output(
            [
                "docker",
                "exec",
                "ai-demo-pingfederate",
                "sh",
                "-lc",
                'printf %s "$PING_IDENTITY_PASSWORD"',
            ],
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(
            "Set PINGFEDERATE_ADMIN_PASSWORD or start ai-demo-pingfederate"
        ) from exc


def api_request(
    method: str,
    path: str,
    auth_header: str,
    payload: dict[str, Any] | None = None,
) -> tuple[int, Any | None]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{PF_API_BASE}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": auth_header,
            "X-XSRF-Header": "x",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(
            request, context=ssl._create_unverified_context(), timeout=20
        ) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        # Do not print the response body: the client update representation
        # contains PingFederate's encrypted client-secret fields.
        return exc.code, None
    except (OSError, TimeoutError) as exc:
        raise RuntimeError(f"PF Admin API {method} {path} failed: {exc}") from exc


def canonical(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: canonical(item)
            for key, item in sorted(value.items())
            if key not in {"creationDate", "modificationDate"}
        }
    if isinstance(value, list):
        return [canonical(item) for item in value]
    return value


def resource_path(collection: str, identity: str | None = None) -> str:
    if identity is None:
        return collection
    return f"{collection}/{urllib.parse.quote(identity, safe='')}"


def ensure_resource(
    name: str,
    collection: str,
    identity: str,
    desired: dict[str, Any],
    auth_header: str,
    apply: bool,
) -> None:
    item_path = resource_path(collection, identity)
    status, current = api_request("GET", item_path, auth_header)
    if status == 404:
        action = "CREATE"
        method = "POST"
        path = collection
        payload = desired
    elif status == 200 and isinstance(current, dict):
        if canonical(current) == canonical(desired):
            print(f"OK {name} already matches")
            return
        action = "UPDATE"
        method = "PUT"
        path = item_path
        payload = desired
    else:
        raise RuntimeError(f"PF Admin API GET {item_path} returned HTTP {status}")

    print(f"{action} {name} ({identity})")
    if not apply:
        return
    result, _ = api_request(method, path, auth_header, payload)
    if result not in (200, 201, 204):
        raise RuntimeError(f"PF Admin API {method} {path} returned HTTP {result}")


def ensure_actor_client(auth_header: str, apply: bool) -> None:
    path = resource_path("/oauth/clients", ACTOR_CLIENT_ID)
    status, client = api_request("GET", path, auth_header)
    if status != 200 or not isinstance(client, dict):
        raise RuntimeError(f"PF Admin API GET {path} returned HTTP {status}")

    grant_types = client.get("grantTypes")
    if not isinstance(grant_types, list) or "CLIENT_CREDENTIALS" not in grant_types:
        raise RuntimeError(
            f"{ACTOR_CLIENT_ID} must retain its CLIENT_CREDENTIALS grant"
        )
    atm = client.get("defaultAccessTokenManagerRef")
    if not isinstance(atm, dict) or atm.get("id") != ATM_ID:
        raise RuntimeError(f"{ACTOR_CLIENT_ID} is not bound to {ATM_ID}")

    policy_ref = resource_link(
        "/oauth/tokenExchange/processor/policies", POLICY_ID
    )
    target_grants = list(dict.fromkeys([*grant_types, "TOKEN_EXCHANGE"]))
    current_policy_ref = client.get("tokenExchangeProcessorPolicyRef")
    matches = (
        target_grants == grant_types
        and isinstance(current_policy_ref, dict)
        and current_policy_ref.get("id") == POLICY_ID
    )
    if matches:
        print(f"OK {ACTOR_CLIENT_ID} already has TOKEN_EXCHANGE and {POLICY_ID}")
        return

    client["grantTypes"] = target_grants
    client["tokenExchangeProcessorPolicyRef"] = policy_ref
    print(
        f"UPDATE {ACTOR_CLIENT_ID} (retain CLIENT_CREDENTIALS, add TOKEN_EXCHANGE, "
        f"attach {POLICY_ID}; existing secret is preserved)"
    )
    if not apply:
        return
    result, _ = api_request("PUT", path, auth_header, client)
    if result not in (200, 201, 204):
        raise RuntimeError(f"PF Admin API PUT {path} returned HTTP {result}")


def verify_readback(auth_header: str) -> None:
    policy_path = resource_path("/oauth/tokenExchange/processor/policies", POLICY_ID)
    status, policy = api_request("GET", policy_path, auth_header)
    if status != 200 or not isinstance(policy, dict):
        raise RuntimeError(f"PF readback failed for {POLICY_ID}: HTTP {status}")
    if not policy.get("actorTokenRequired"):
        raise RuntimeError(f"PF readback: {POLICY_ID} does not require actor_token")
    mappings = policy.get("processorMappings", [])
    if len(mappings) != 1 or mappings[0].get("subjectTokenType") != (
        "urn:ietf:params:oauth:token-type:access_token"
    ):
        raise RuntimeError(f"PF readback: {POLICY_ID} is not access-token-only")

    mapping_id = (
        "urn:ietf:params:oauth:grant-type:token-exchange|"
        f"{POLICY_ID}|{ATM_ID}"
    )
    mapping_path = resource_path("/oauth/accessTokenMappings", mapping_id)
    status, mapping = api_request("GET", mapping_path, auth_header)
    if status != 200 or not isinstance(mapping, dict):
        raise RuntimeError(f"PF readback failed for Step 9 ATM mapping: HTTP {status}")
    act = mapping.get("attributeContractFulfillment", {}).get("act", {})
    if act.get("source", {}).get("type") != "EXPRESSION" or "tepp.priorAct" not in act.get("value", ""):
        raise RuntimeError("PF readback: Step 9 mapping does not preserve prior act")

    client_path = resource_path("/oauth/clients", ACTOR_CLIENT_ID)
    status, client = api_request("GET", client_path, auth_header)
    if status != 200 or not isinstance(client, dict):
        raise RuntimeError(f"PF readback failed for {ACTOR_CLIENT_ID}: HTTP {status}")
    if not {"CLIENT_CREDENTIALS", "TOKEN_EXCHANGE"}.issubset(
        set(client.get("grantTypes", []))
    ):
        raise RuntimeError("PF readback: actor client lost a required grant")
    readback_atm = client.get("defaultAccessTokenManagerRef")
    if not isinstance(readback_atm, dict) or readback_atm.get("id") != ATM_ID:
        raise RuntimeError("PF readback: actor client ATM changed")
    readback_policy = client.get("tokenExchangeProcessorPolicyRef")
    if not isinstance(readback_policy, dict) or readback_policy.get("id") != POLICY_ID:
        raise RuntimeError("PF readback: actor client policy reference is missing")
    print(
        "READBACK OK: dedicated access-token Step 9 policy, nested act mapping, "
        "and actor-client grants/ATM/policy reference"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="apply the reviewed changes (default: report the plan only)",
    )
    args = parser.parse_args()

    try:
        password = get_password()
        if not password:
            raise RuntimeError("PingFederate admin password is empty")
        auth_header = "Basic " + base64.b64encode(
            f"administrator:{password}".encode("utf-8")
        ).decode("ascii")
        policy = json.loads(
            (ROOT / "spiffe/pingfederate/pf-step9-te-policy.json").read_text()
        )
        mapping = json.loads(
            (ROOT / "spiffe/pingfederate/pf-step9-atm-mapping.json").read_text()
        )

        ensure_resource(
            "dedicated PF Step 9 policy",
            "/oauth/tokenExchange/processor/policies",
            POLICY_ID,
            policy,
            auth_header,
            args.apply,
        )
        ensure_resource(
            "dedicated PF Step 9 ATM mapping",
            "/oauth/accessTokenMappings",
            mapping["id"],
            mapping,
            auth_header,
            args.apply,
        )
        ensure_actor_client(auth_header, args.apply)
        if args.apply:
            verify_readback(auth_header)
        else:
            print("Dry-run only. Pass --apply to write these three scoped changes.")
    except (OSError, RuntimeError, json.JSONDecodeError) as exc:
        print(f"PF Step 9 provisioning failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
