"""
Unit tests for PrivilegeConfig wiring and the production URL-scheme allowlist.
"""
import os
from unittest.mock import patch

import pytest


def _base_env():
    return {
        "PINGONE_BASE_URL": "http://localhost",
        "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "http://localhost/reg",
        "PINGONE_TOKEN_ENDPOINT": "http://localhost/token",
        "PINGONE_AUTHORIZATION_ENDPOINT": "http://localhost/auth",
        "PINGONE_REDIRECT_URI": "http://localhost/callback",
    }


def test_privilege_config_defaults_blank():
    import src.config.settings as settings_mod
    with patch.dict(os.environ, _base_env(), clear=True):
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    assert config.privilege.client_id == ""
    assert config.privilege.callback_port == 8765


def test_privilege_config_env_override():
    import src.config.settings as settings_mod
    env = {
        **_base_env(),
        "PRIVILEGE_MCP_CLIENT_ID": "libre-client",
        "PRIVILEGE_MCP_CLIENT_SECRET": "s3cret",
        "PRIVILEGE_MCP_AUTHORIZE_URL": "https://privilege.example/authorize",
        "PRIVILEGE_MCP_TOKEN_URL": "https://privilege.example/token",
        "PRIVILEGE_MCP_REDIRECT_URI": "http://127.0.0.1:8765/callback",
        "PRIVILEGE_MCP_SCOPE": "mcp.read mcp.write",
        "PRIVILEGE_MCP_CALLBACK_PORT": "9999",
    }
    with patch.dict(os.environ, env, clear=True):
        import src.config.settings as settings_mod
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    assert config.privilege.client_id == "libre-client"
    assert config.privilege.callback_port == 9999


def test_save_config_redacts_privilege_secret(tmp_path):
    import src.config.settings as settings_mod
    env = {**_base_env(), "PRIVILEGE_MCP_CLIENT_SECRET": "s3cret"}
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        config = mgr.load_config("development")
    out = tmp_path / "config.json"
    mgr.save_config_to_file(config, out)
    body = out.read_text()
    assert "s3cret" not in body


def _production_env(**overrides):
    # ProductionConfig.validate_config() (settings.py:267-276) additionally
    # requires HTTPS PingOne base_url and a WARNING+ log level — set both
    # explicitly so these tests fail (or pass) for the scheme-check reason
    # being tested, not an unrelated production-validation error.
    env = {
        **_base_env(),
        "PINGONE_BASE_URL": "https://pingone.example",
        "ENVIRONMENT": "production",
        "DEBUG": "false",
        "LOG_LEVEL": "WARNING",
    }
    env.update(overrides)
    return env


def test_mcp_server_endpoint_https_allowed_in_production():
    import src.config.settings as settings_mod
    env = _production_env(
        MCP_SERVER_PRIVILEGE_ENDPOINT="https://cmuir-agentless-mcpgw.ping-devops.com/app/mcp",
    )
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        configs = mgr.get_mcp_server_configs()
    assert configs["privilege"]["endpoint"].startswith("https://")


def test_mcp_server_endpoint_plain_http_rejected_in_production():
    import src.config.settings as settings_mod
    env = _production_env(
        MCP_SERVER_PRIVILEGE_ENDPOINT="http://cmuir-agentless-mcpgw.ping-devops.com/app/mcp",
    )
    with patch.dict(os.environ, env, clear=True):
        mgr = settings_mod.ConfigManager()
        with pytest.raises(ValueError, match="wss://, https://, or local://"):
            mgr.get_mcp_server_configs()
