"""
OAuth 2.0 Authorization Code + PKCE flow for the PingOne Privilege Cloud MCP
Gateway (agentless mode). Used by external_client.py to obtain a bearer token
as a standalone CLI, outside the BFF-mediated user-authorization flow that
authentication/oauth_manager.py's UserAuthorizationFacilitator implements —
that class expects a running web app to catch the redirect and hands the code
off to an MCP server for exchange; this module does both itself, in-process,
since there is no running app here.

Nothing here is persisted to disk. The access token lives only in the
returned AccessToken object, for the calling process's lifetime.
"""
import logging
import secrets
import string
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Dict, Optional
from urllib.parse import urlencode, urlparse, parse_qs

import httpx

from src.authentication.oauth_manager import UserAuthorizationFacilitator
from src.config.settings import PrivilegeConfig
from src.models.auth import AccessToken

logger = logging.getLogger(__name__)


class PrivilegeAuthError(Exception):
    """Raised when the Privilege PKCE flow fails at any stage."""


def generate_state() -> str:
    """Generate a cryptographically secure, URL-safe state parameter."""
    alphabet = string.ascii_letters + string.digits + "-_"
    return "".join(secrets.choice(alphabet) for _ in range(32))


def build_authorize_url(config: PrivilegeConfig, state: str, code_challenge: str) -> str:
    """Build the PingOne Privilege authorize URL for the browser to open."""
    params = {
        "response_type": "code",
        "client_id": config.client_id,
        "redirect_uri": config.redirect_uri,
        "scope": config.scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{config.authorize_url}?{urlencode(params)}"
