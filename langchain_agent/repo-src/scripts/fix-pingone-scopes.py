#!/usr/bin/env python3

"""
PingOne Scope Configuration Auto-Fix
=====================================

Automatically fixes scope configuration for RFC 8693 token exchange by calling
PingOne Management API.

Usage:
    python3 fix-pingone-scopes.py \\
        --env-id <environment-id> \\
        --worker-id <worker-client-id> \\
        --worker-secret <worker-client-secret> \\
        [--region com] \\
        [--dry-run]

Requirements:
    pip install requests
    
Example:
    export PINGONE_ENVIRONMENT_ID="d02d2305-f445-406d-82ee-7cdbf6eeabfd"
    export PINGONE_WORKER_CLIENT_ID="abc123..."
    export PINGONE_WORKER_CLIENT_SECRET="xyz789..."
    python3 fix-pingone-scopes.py
"""

import sys
import os
import json
import argparse
import requests
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
CYAN = '\033[0;36m'
NC = '\033[0m'  # No Color

# App IDs
USER_APP_ID = "b2752071-2d03-4927-b865-089dc40b9c85"
ADMIN_APP_ID = "14cefa5b-d9d6-4e51-8749-e938d4edd1c0"
MCP_EXCHANGER_ID = "6380065f-f328-41c2-81ed-1daeec811285"
WORKER_APP_ID = "95dc946f-5e0a-4a8b-a8ba-b587b244e005"

# Scope configurations (what each app should have)
SCOPE_CONFIG = {
    USER_APP_ID: {
        "name": "Super Banking User App",
        "add": [
            "banking:ai:agent:read",
            "banking:general:read",
            "banking:accounts:read",
            "banking:transactions:read",
            "banking:transactions:write",
        ],
        "remove": [],
    },
    ADMIN_APP_ID: {
        "name": "Super Banking Admin App",
        "add": [
            # Banking API scopes
            "banking:accounts:read",
            "banking:accounts:write",
            "banking:accounts:admin",
            "banking:transactions:read",
            "banking:transactions:write",
            "banking:transactions:admin",
            "banking:general:read",
            "banking:general:write",
            "banking:general:admin",
            "banking:ai:agent:read",
            "banking:ai:agent:write",
            "banking:ai:agent:admin",
            "banking:admin",
            # MCP Server scopes
            "admin:read",
            "admin:write",
            "admin:delete",
            "users:read",
            "users:manage",
        ],
        "remove": ["openid"],
    },
    MCP_EXCHANGER_ID: {
        "name": "Super Banking MCP Token Exchanger",
        "add": [
            "banking:ai:agent:read",
            "banking:transactions:read",
            "banking:general:read",
            "admin:read",
        ],
        "remove": [
            "agent:invoke",
            "banking:agent:invoke",
            "banking:transactions:write",
            "openid",
            "p1:update:user",
        ],
    },
    WORKER_APP_ID: {
        "name": "Super Banking Worker Token",
        "add": ["p1:read:user", "p1:update:user"],
        "remove": [],
    },
}


class PingOneAPIClient:
    """Client for PingOne Management API"""

    def __init__(self, env_id: str, worker_id: str, worker_secret: str, region: str = "com"):
        self.env_id = env_id
        self.region = region
        self.base_url = f"https://api.pingone.{region}/{env_id}"
        self.auth_url = f"https://auth.pingone.{region}/{env_id}/as/token"
        self.worker_token = None
        self._auth = (worker_id, worker_secret)

    def authenticate(self) -> bool:
        """Get worker authentication token"""
        try:
            response = requests.post(
                self.auth_url,
                auth=self._auth,
                data={"grant_type": "client_credentials"},
                timeout=10,
            )
            response.raise_for_status()
            self.worker_token = response.json().get("access_token")
            return bool(self.worker_token)
        except Exception as e:
            print(f"{RED}✗ Authentication failed: {e}{NC}")
            return False

    def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[Dict] = None,
    ) -> Optional[Dict]:
        """Make authenticated API request"""
        headers = {
            "Authorization": f"Bearer {self.worker_token}",
            "Content-Type": "application/json",
        }
        url = urljoin(self.base_url, endpoint.lstrip("/"))

        try:
            if method.upper() == "GET":
                response = requests.get(url, headers=headers, timeout=10)
            elif method.upper() == "POST":
                response = requests.post(url, headers=headers, json=data, timeout=10)
            elif method.upper() == "PUT":
                response = requests.put(url, headers=headers, json=data, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")

            response.raise_for_status()
            return response.json() if response.content else {}
        except Exception as e:
            print(f"{RED}✗ API request failed ({method} {endpoint}): {e}{NC}")
            return None

    def get_resources(self) -> Dict[str, Any]:
        """Get all resource servers and build scope mapping"""
        resources = self._request("GET", "/resources")
        if not resources:
            return {}

        resource_map = {}
        for resource in resources.get("_embedded", {}).get("resources", []):
            name = resource.get("name", "")
            resource_id = resource.get("id")
            
            # Get scopes for this resource
            scopes_response = self._request("GET", f"/resources/{resource_id}/scopes")
            scopes = {}
            if scopes_response:
                for scope in scopes_response.get("_embedded", {}).get("scopes", []):
                    scopes[scope.get("name")] = scope.get("id")
            
            resource_map[name] = {
                "id": resource_id,
                "scopes": scopes,
            }

        return resource_map

    def get_app_grants(self, app_id: str) -> Dict[str, Any]:
        """Get current scope grants for an application"""
        response = self._request("GET", f"/applications/{app_id}/grants")
        if not response:
            return {"grants": []}
        return response

    def grant_scopes(
        self,
        app_id: str,
        scopes: List[str],
        resource_map: Dict[str, Any],
    ) -> bool:
        """Grant scopes to application"""
        # Find scope IDs in resource map
        scope_ids = []
        for scope_name in scopes:
            found = False
            for resource_name, resource_info in resource_map.items():
                if scope_name in resource_info["scopes"]:
                    scope_ids.append(resource_info["scopes"][scope_name])
                    found = True
                    break
            
            if not found:
                print(f"{YELLOW}⚠ Scope '{scope_name}' not found in any resource{NC}")

        if not scope_ids:
            return True

        # Grant all scopes at once
        for scope_id in scope_ids:
            data = {"scopeId": scope_id}
            if not self._request("POST", f"/applications/{app_id}/grants", data):
                return False

        return True

    def revoke_scope(self, app_id: str, grant_id: str) -> bool:
        """Revoke a scope grant from application"""
        return bool(self._request("DELETE", f"/applications/{app_id}/grants/{grant_id}"))

    def find_grants_by_scope_name(
        self,
        app_id: str,
        scope_name: str,
        resource_map: Dict[str, Any],
    ) -> List[str]:
        """Find grant IDs for scope names to remove"""
        grants_response = self._request("GET", f"/applications/{app_id}/grants")
        if not grants_response:
            return []

        grant_ids = []
        target_scope_id = None

        # Find target scope ID
        for resource_name, resource_info in resource_map.items():
            if scope_name in resource_info["scopes"]:
                target_scope_id = resource_info["scopes"][scope_name]
                break

        if not target_scope_id:
            return []

        # Find matching grants
        for grant in grants_response.get("_embedded", {}).get("grants", []):
            if grant.get("scope", {}).get("id") == target_scope_id:
                grant_ids.append(grant.get("id"))

        return grant_ids


def main():
    parser = argparse.ArgumentParser(description="Fix PingOne scope configuration")
    parser.add_argument(
        "--env-id",
        default=os.getenv("PINGONE_ENVIRONMENT_ID"),
        help="PingOne environment ID",
    )
    parser.add_argument(
        "--worker-id",
        default=os.getenv("PINGONE_WORKER_CLIENT_ID"),
        help="Worker app client ID",
    )
    parser.add_argument(
        "--worker-secret",
        default=os.getenv("PINGONE_WORKER_CLIENT_SECRET"),
        help="Worker app client secret",
    )
    parser.add_argument(
        "--region",
        default=os.getenv("PINGONE_REGION", "com"),
        help="PingOne region (default: com)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be changed without making changes",
    )

    args = parser.parse_args()

    # Validate arguments
    if not args.env_id or not args.worker_id or not args.worker_secret:
        print(f"{RED}✗ Error: Missing required credentials${NC}")
        print("Set: PINGONE_ENVIRONMENT_ID, PINGONE_WORKER_CLIENT_ID, PINGONE_WORKER_CLIENT_SECRET")
        sys.exit(1)

    print(f"{BLUE}═══════════════════════════════════════════════════════{NC}")
    print(f"{BLUE}PingOne RFC 8693 Scope Configuration Auto-Fix{NC}")
    print(f"{BLUE}═══════════════════════════════════════════════════════{NC}")

    if args.dry_run:
        print(f"{YELLOW}[DRY-RUN MODE] — Changes will not be applied{NC}\n")

    # Initialize client
    client = PingOneAPIClient(args.env_id, args.worker_id, args.worker_secret, args.region)

    print(f"\n{CYAN}[1/3] Authenticating to PingOne...{NC}")
    if not client.authenticate():
        sys.exit(1)
    print(f"{GREEN}✓ Authenticated{NC}")

    print(f"\n{CYAN}[2/3] Loading resource servers and scopes...{NC}")
    resource_map = client.get_resources()
    if not resource_map:
        print(f"{RED}✗ Failed to load resources{NC}")
        sys.exit(1)
    
    print(f"{GREEN}✓ Found {len(resource_map)} resource servers{NC}")
    for name in resource_map:
        scope_count = len(resource_map[name]["scopes"])
        print(f"  • {name}: {scope_count} scopes")

    print(f"\n{CYAN}[3/3] Applying scope fixes...{NC}\n")

    # Process each app
    summary = {"success": 0, "failed": 0, "skipped": 0}

    for app_id, config in SCOPE_CONFIG.items():
        app_name = config["name"]
        print(f"\n{CYAN}→ {app_name}{NC}")

        if args.dry_run:
            if config["add"]:
                print(f"  {YELLOW}[DRY-RUN] Would ADD {len(config['add'])} scopes:{NC}")
                for scope in config["add"]:
                    print(f"    • {scope}")
            
            if config["remove"]:
                print(f"  {YELLOW}[DRY-RUN] Would REMOVE {len(config['remove'])} scopes:{NC}")
                for scope in config["remove"]:
                    print(f"    • {scope}")
        else:
            # Add required scopes
            if config["add"]:
                print(f"  Adding {len(config['add'])} scopes...")
                if client.grant_scopes(app_id, config["add"], resource_map):
                    print(f"  {GREEN}✓ Scopes added{NC}")
                    summary["success"] += 1
                else:
                    print(f"  {RED}✗ Failed to add scopes{NC}")
                    summary["failed"] += 1
            else:
                print(f"  {YELLOW}No scopes to add${NC}")
            
            # Remove unwanted scopes
            if config["remove"]:
                print(f"  Removing {len(config['remove'])} scopes...")
                grants_response = client._request("GET", f"/applications/{app_id}/grants")
                
                removed_count = 0
                for scope_name in config["remove"]:
                    grant_ids = client.find_grants_by_scope_name(app_id, scope_name, resource_map)
                    for grant_id in grant_ids:
                        if client.revoke_scope(app_id, grant_id):
                            removed_count += 1
                
                if removed_count > 0:
                    print(f"  {GREEN}✓ {removed_count} scopes removed${NC}")
                else:
                    print(f"  {YELLOW}⚠ No scopes to remove (may already be removed)${NC}")
            else:
                print(f"  {YELLOW}No scopes to remove${NC}")

    print(f"\n{BLUE}═══════════════════════════════════════════════════════{NC}")
    print(f"{BLUE}Summary${NC}")
    print(f"{BLUE}═══════════════════════════════════════════════════════{NC}")
    print(f"✓ Successful: {summary['success']}")
    print(f"✗ Failed: {summary['failed']}")
    print(f"⊘ Skipped: {summary['skipped']}")

    if args.dry_run:
        print(f"\n{YELLOW}This was a dry-run. Run without --dry-run to apply changes.${NC}")
    else:
        print(f"\n{GREEN}PingOne scope configuration updated!${NC}")
        print(f"\n{CYAN}Next steps:${NC}")
        print(f"  1. Verify changes in PingOne console")
        print(f"  2. Run: /gsd-execute-phase 111 (to update code config)")
        print(f"  3. Test token exchange flow")

if __name__ == "__main__":
    main()
