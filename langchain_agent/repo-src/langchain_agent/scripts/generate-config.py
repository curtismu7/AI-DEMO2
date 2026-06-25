#!/usr/bin/env python3
"""
Configuration generator script for LangChain MCP OAuth Agent.

This script generates environment-specific configuration files and templates.
"""

import argparse
import sys
from pathlib import Path
import secrets
import base64

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from config.settings import ConfigManager


def generate_encryption_keys():
    """Generate secure encryption keys."""
    master_key = base64.b64encode(secrets.token_bytes(32)).decode()
    salt = base64.b64encode(secrets.token_bytes(16)).decode()
    return master_key, salt


def create_env_file(environment: str, output_path: Path, include_secrets: bool = False):
    """Create environment-specific .env file."""
    manager = ConfigManager()
    
    # Get environment-specific defaults
    env_config = manager._environment_configs.get(environment)
    if not env_config:
        raise ValueError(f"Unknown environment: {environment}")
    
    defaults = env_config.get_default_values()
    
    # Generate encryption keys if needed
    master_key, salt = generate_encryption_keys()
    
    lines = [
        f"# Configuration for {environment} environment",
        f"# Generated on {Path(__file__).name}",
        "",
        f"ENVIRONMENT={environment}",
    ]
    
    # Add environment-specific defaults
    for key, value in defaults.items():
        lines.append(f"{key}={value}")
    
    lines.extend([
        "",
        "# PingOne AI IAM Core Configuration",
        "# Replace 'your-tenant' with your actual ForgeRock tenant name",
        "PINGONE_BASE_URL=https://your-tenant.forgeblocks.com",
        "PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
        "PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token", 
        "PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
        "PINGONE_DEFAULT_SCOPE=openid profile",
        "PINGONE_REALM=alpha",
    ])
    
    # Add redirect URI based on environment
    if environment == "development":
        lines.append("PINGONE_REDIRECT_URI=http://localhost:8080/auth/callback")
    else:
        lines.append("PINGONE_REDIRECT_URI=https://your-domain.com/auth/callback")
    
    lines.extend([
        "",
        "# Security Configuration",
    ])
    
    if include_secrets:
        lines.extend([
            f"ENCRYPTION_MASTER_KEY={master_key}",
            f"ENCRYPTION_SALT={salt}",
        ])
    else:
        lines.extend([
            "ENCRYPTION_MASTER_KEY=your-base64-encoded-master-key-here",
            "ENCRYPTION_SALT=your-base64-encoded-salt-here",
        ])
    
    lines.extend([
        "",
        "# API Keys",
        "OPENAI_API_KEY=your-openai-api-key-here",
        "",
        "# MCP Server Configuration (add as needed)",
        "# MCP_SERVER_GITHUB_ENDPOINT=ws://localhost:3001",
        "# MCP_SERVER_GITHUB_CAPABILITIES=read,write",
        "# MCP_SERVER_GITHUB_AUTH_REQUIRED=true",
        "",
        "# MCP_SERVER_SLACK_ENDPOINT=ws://localhost:3002", 
        "# MCP_SERVER_SLACK_CAPABILITIES=read,write,execute",
        "# MCP_SERVER_SLACK_AUTH_REQUIRED=true",
    ])
    
    # Write to file
    output_path.write_text("\n".join(lines))
    print(f"✅ Created {environment} configuration: {output_path}")
    
    if include_secrets:
        print(f"🔐 Generated encryption keys:")
        print(f"   ENCRYPTION_MASTER_KEY: {master_key}")
        print(f"   ENCRYPTION_SALT: {salt}")


def create_docker_env(output_path: Path):
    """Create Docker-specific environment file."""
    lines = [
        "# Docker environment configuration",
        "# This file is used by docker-compose.yml",
        "",
        "# Application settings",
        "ENVIRONMENT=production",
        "DEBUG=false",
        "LOG_LEVEL=INFO",
        "",
        "# Container settings", 
        "WEBSOCKET_PORT=8080",
        "",
        "# Health check settings",
        "HEALTH_CHECK_INTERVAL=30s",
        "HEALTH_CHECK_TIMEOUT=10s",
        "HEALTH_CHECK_RETRIES=3",
        "",
        "# Volume mounts",
        "LOGS_DIR=./logs",
        "DATA_DIR=./data",
        "",
        "# Network settings",
        "NETWORK_NAME=mcp-network",
    ]
    
    output_path.write_text("\n".join(lines))
    print(f"✅ Created Docker environment file: {output_path}")


def validate_config(environment: str):
    """Validate configuration for environment."""
    try:
        manager = ConfigManager()
        config = manager.load_config(environment)
        print(f"✅ Configuration for {environment} is valid")
        return True
    except Exception as e:
        print(f"❌ Configuration validation failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Generate configuration files for LangChain MCP OAuth Agent"
    )
    parser.add_argument(
        "command",
        choices=["env", "docker", "validate", "keys"],
        help="Command to execute"
    )
    parser.add_argument(
        "--environment", "-e",
        choices=["development", "staging", "production", "test"],
        default="development",
        help="Target environment"
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        help="Output file path"
    )
    parser.add_argument(
        "--include-secrets",
        action="store_true",
        help="Include generated secrets in output"
    )
    
    args = parser.parse_args()
    
    if args.command == "env":
        output_path = args.output or Path(f".env.{args.environment}")
        create_env_file(args.environment, output_path, args.include_secrets)
        
    elif args.command == "docker":
        output_path = args.output or Path(".env.docker")
        create_docker_env(output_path)
        
    elif args.command == "validate":
        if not validate_config(args.environment):
            sys.exit(1)
            
    elif args.command == "keys":
        master_key, salt = generate_encryption_keys()
        print("🔐 Generated encryption keys:")
        print(f"ENCRYPTION_MASTER_KEY={master_key}")
        print(f"ENCRYPTION_SALT={salt}")
        print("")
        print("Add these to your .env file")


if __name__ == "__main__":
    main()