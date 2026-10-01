#!/usr/bin/env python3
"""Provision the local PingFederate demo-admin login.

The PF HTML Form adapter ships a native password-reset flow, but the local demo
does not have a reset-capable validator or notification publisher.  This script
therefore provisions the PF demo user only; the companion template patch adds a
safe recovery link that explains the local operator reset path instead of
exposing a dead native action.

Default mode is a read-only plan.  ``--apply`` updates the local PF admin API.
The demo-admin password is read from ``DEMO_ADMIN_PASSWORD`` (or the environment
variable named by ``--password-env``); it is never printed.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
from typing import Any


DEFAULT_BASE = "https://127.0.0.1:9999/pf-admin-api/v1"
PCV_PATH = "/passwordCredentialValidators/aiDemoPfSimplePcv"


def _field_map(row: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(field.get("name", "")): field
        for field in row.get("fields", [])
        if isinstance(field, dict) and field.get("name")
    }


def find_user_row(pcv: dict[str, Any], username: str) -> dict[str, Any] | None:
    """Return the matching user row and normalized username, if present."""
    wanted = str(username).strip().casefold()
    tables = pcv.get("configuration", {}).get("tables", [])
    for table in tables:
        if table.get("name") != "Users":
            continue
        for row in table.get("rows", []):
            fields = _field_map(row)
            actual = str(fields.get("Username", {}).get("value", "")).strip()
            if actual.casefold() == wanted:
                return {"row": row, "username": actual}
    return None


def _set_plaintext_field(row: dict[str, Any], name: str, value: str) -> None:
    fields = row.setdefault("fields", [])
    for field in fields:
        if field.get("name") == name:
            field.pop("encryptedValue", None)
            field["value"] = value
            return
    fields.append({"name": name, "value": value})


def build_pcv_update(pcv: dict[str, Any], username: str, password: str) -> dict[str, Any]:
    """Return a PCV payload with ``username`` present and its password set."""
    if not str(username).strip():
        raise ValueError("username is required")
    if not isinstance(password, str) or not password:
        raise ValueError("password is required")

    updated = copy.deepcopy(pcv)
    tables = updated.setdefault("configuration", {}).setdefault("tables", [])
    users_table = next((table for table in tables if table.get("name") == "Users"), None)
    if users_table is None:
        users_table = {"name": "Users", "rows": []}
        tables.append(users_table)

    match = find_user_row(updated, username)
    if match is None:
        row = {
            "fields": [
                {"name": "Username", "value": str(username).strip()},
                {"name": "Relax Password Requirements", "value": "true"},
                {"name": "Password", "value": password},
                {"name": "Confirm Password", "value": password},
            ],
            "defaultRow": False,
        }
        users_table.setdefault("rows", []).append(row)
        return updated

    row = match["row"]
    _set_plaintext_field(row, "Username", match["username"] or str(username).strip())
    _set_plaintext_field(row, "Relax Password Requirements", "true")
    _set_plaintext_field(row, "Password", password)
    _set_plaintext_field(row, "Confirm Password", password)
    return updated


def _admin_password() -> str:
    configured = os.environ.get("PINGFEDERATE_ADMIN_PASSWORD", "")
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
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError(
            "Set PINGFEDERATE_ADMIN_PASSWORD or start ai-demo-pingfederate"
        ) from exc


def _password_from_env(name: str) -> str:
    value = os.environ.get(name, "")
    if value:
        return value
    raise RuntimeError(f"{name} is not set; refusing to change a live password")


def _request_json(base: str, path: str, admin_password: str, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
    credentials = base64.b64encode(f"administrator:{admin_password}".encode()).decode()
    body = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Basic {credentials}",
            "X-XSRF-Header": "x",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, context=ssl._create_unverified_context(), timeout=20) as response:
            raw = response.read()
            return json.loads(raw.decode()) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read(600).decode("utf-8", "replace")
        raise RuntimeError(f"PingFederate {method} {path} failed with HTTP {exc.code}: {detail}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"PingFederate {method} {path} failed: {exc}") from exc


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write the reviewed configuration to local PF")
    parser.add_argument("--base", default=os.environ.get("PF_BASE", DEFAULT_BASE), help=argparse.SUPPRESS)
    parser.add_argument("--username", default="demoadmin", help="PF username to provision (default: demoadmin)")
    parser.add_argument("--password-env", default="DEMO_ADMIN_PASSWORD", help="environment variable containing the password")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        admin_password = _admin_password()
        demo_password = _password_from_env(args.password_env)
        pcv = _request_json(args.base, PCV_PATH, admin_password)
        pcv_update = build_pcv_update(pcv, args.username, demo_password)

        print(f"PF login plan: ensure user {args.username!r}; keep native reset disabled; use the local recovery link.")
        if not args.apply:
            print("Dry-run only. Pass --apply to write the local PingFederate configuration.")
            return 0

        original_pcv = pcv
        try:
            _request_json(args.base, PCV_PATH, admin_password, "PUT", pcv_update)
        except Exception:
            # Best-effort rollback prevents a half-applied live configuration.
            try:
                _request_json(args.base, PCV_PATH, admin_password, "PUT", original_pcv)
            except Exception:
                pass
            raise

        verified_pcv = _request_json(args.base, PCV_PATH, admin_password)
        if find_user_row(verified_pcv, args.username) is None:
            raise RuntimeError("PF read-back did not contain the requested demo user")
        print("PF demo-admin login provisioned and verified; password value was not displayed.")
        return 0
    except (RuntimeError, ValueError) as exc:
        print(f"PF demo-admin provisioning failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
