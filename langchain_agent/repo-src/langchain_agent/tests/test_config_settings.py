"""
Unit tests for configuration management.
"""
import os
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
import pytest

from src.config.settings import (
    ConfigManager, AppConfig, PingOneConfig, SecurityConfig,
    DevelopmentConfig, ProductionConfig, StagingConfig, TestConfig
)


class TestEnvironmentConfigs:
    """Test environment-specific configuration classes."""
    
    def test_development_config(self):
        """Test development environment configuration."""
        config = DevelopmentConfig()
        
        assert config.get_environment_name() == "development"
        
        defaults = config.get_default_values()
        assert defaults["DEBUG"] == "true"
        assert defaults["LOG_LEVEL"] == "DEBUG"
        assert defaults["LANGCHAIN_VERBOSE"] == "true"
        
        # Test validation - should allow localhost URLs
        app_config = self._create_test_config("development")
        app_config.pingone.base_url = "http://localhost:8080"
        config.validate_config(app_config)  # Should not raise
        
        # Test validation - should allow ForgeRock URLs
        app_config.pingone.base_url = "https://test.forgeblocks.com"
        config.validate_config(app_config)  # Should not raise
        
        # Test validation - should reject invalid URLs
        app_config.pingone.base_url = "https://invalid-url.com"
        with pytest.raises(ValueError, match="should use localhost, ForgeRock cloud, or PingOne auth URLs"):
            config.validate_config(app_config)
    
    def test_production_config(self):
        """Test production environment configuration."""
        config = ProductionConfig()
        
        assert config.get_environment_name() == "production"
        
        defaults = config.get_default_values()
        assert defaults["DEBUG"] == "false"
        assert defaults["LOG_LEVEL"] == "WARNING"
        # Production inherits the base LANGCHAIN_MODEL_NAME default (no override)
        assert "LANGCHAIN_MODEL_NAME" not in defaults

        # Test validation - should reject debug mode
        app_config = self._create_test_config("production")
        app_config.debug = True
        with pytest.raises(ValueError, match="Debug mode must be disabled"):
            config.validate_config(app_config)

        # Test validation - should require HTTPS
        app_config = self._create_test_config("production")
        app_config.log_level = "WARNING"  # Set valid log level first
        app_config.pingone.base_url = "http://test.com"
        with pytest.raises(ValueError, match="must use HTTPS"):
            config.validate_config(app_config)
    
    def test_staging_config(self):
        """Test staging environment configuration."""
        config = StagingConfig()
        
        assert config.get_environment_name() == "staging"
        
        defaults = config.get_default_values()
        assert defaults["DEBUG"] == "false"
        assert defaults["MAX_RETRY_ATTEMPTS"] == "5"
        
        # Test validation
        app_config = self._create_test_config("staging")
        config.validate_config(app_config)  # Should not raise
    
    def test_test_config(self):
        """Test test environment configuration."""
        config = TestConfig()
        
        assert config.get_environment_name() == "test"
        
        defaults = config.get_default_values()
        assert defaults["WEBSOCKET_PORT"] == "8081"
        assert defaults["SESSION_TIMEOUT_MINUTES"] == "5"
        
        # Test validation - should be lenient
        app_config = self._create_test_config("test")
        config.validate_config(app_config)  # Should not raise
    
    def _create_test_config(self, environment: str) -> AppConfig:
        """Create a test configuration."""
        return AppConfig(
            environment=environment,
            debug=False,
            log_level="INFO",
            pingone=PingOneConfig(
                base_url="https://test.forgeblocks.com",
                client_registration_endpoint="https://test.forgeblocks.com/register",
                token_endpoint="https://test.forgeblocks.com/token",
                authorization_endpoint="https://test.forgeblocks.com/auth",
                default_scope="openid profile",
                redirect_uri="https://test.com/callback",
                realm="alpha"
            ),
            security=SecurityConfig(
                token_expiry_buffer_seconds=300,
                session_timeout_minutes=60,
                max_retry_attempts=3,
                retry_backoff_seconds=2
            ),
            mcp=None,  # Not needed for these tests
            chat=None,  # Not needed for these tests
            langchain=None  # Not needed for these tests
        )


class TestConfigManager:
    """Test configuration manager."""
    
    def test_load_config_from_environment(self):
        """Test loading configuration from environment variables."""
        env_vars = {
            "ENVIRONMENT": "development",
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "PINGONE_BASE_URL": "https://test.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://test.forgeblocks.com/register",
            "PINGONE_TOKEN_ENDPOINT": "https://test.forgeblocks.com/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "https://test.forgeblocks.com/auth",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/callback",
            "OPENAI_API_KEY": "test-openai-key",
            "WEBSOCKET_PORT": "8080",
        }
        
        with patch.dict(os.environ, env_vars, clear=True):
            manager = ConfigManager()
            config = manager.load_config()
            
            assert config.environment == "development"
            assert config.debug is True
            assert config.log_level == "DEBUG"
            assert config.pingone.base_url == "https://test.forgeblocks.com"
            assert config.langchain.openai_api_key == "test-openai-key"
            assert config.chat.websocket_port == 8080
    
    def test_load_config_with_file(self):
        """Test loading configuration from JSON file."""
        config_data = {
            "PINGONE_BASE_URL": "https://file.forgeblocks.com",
            "DEBUG": "false",
            "WEBSOCKET_PORT": "9090"
        }
        
        env_vars = {
            "ENVIRONMENT": "development",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://test.forgeblocks.com/register",
            "PINGONE_TOKEN_ENDPOINT": "https://test.forgeblocks.com/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "https://test.forgeblocks.com/auth",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/callback",
            "OPENAI_API_KEY": "test-openai-key",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config_data, f)
            config_file_path = Path(f.name)
        
        try:
            with patch.dict(os.environ, env_vars, clear=True):
                manager = ConfigManager(config_file=config_file_path)
                config = manager.load_config()
                
                # File values should override defaults but not environment variables
                assert config.pingone.base_url == "https://file.forgeblocks.com"
                assert config.debug is False  # From file
                assert config.chat.websocket_port == 9090  # From file
        finally:
            config_file_path.unlink()
    
    def test_environment_variable_priority(self):
        """Test that environment variables take priority over file and defaults."""
        config_data = {
            "DEBUG": "false",
            "WEBSOCKET_PORT": "9090"
        }
        
        env_vars = {
            "ENVIRONMENT": "development",
            "DEBUG": "true",  # Should override file
            "PINGONE_BASE_URL": "https://env.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://test.forgeblocks.com/register",
            "PINGONE_TOKEN_ENDPOINT": "https://test.forgeblocks.com/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "https://test.forgeblocks.com/auth",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/callback",
            "OPENAI_API_KEY": "test-openai-key",
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(config_data, f)
            config_file_path = Path(f.name)
        
        try:
            with patch.dict(os.environ, env_vars, clear=True):
                manager = ConfigManager(config_file=config_file_path)
                config = manager.load_config()
                
                assert config.debug is True  # Environment overrides file
                assert config.chat.websocket_port == 9090  # File value used
        finally:
            config_file_path.unlink()
    
    def test_missing_required_variable(self):
        """Test error handling for missing required variables."""
        env_vars = {
            "ENVIRONMENT": "development",
            # Missing PINGONE_BASE_URL
        }
        
        with patch.dict(os.environ, env_vars, clear=True):
            manager = ConfigManager()
            with pytest.raises(ValueError, match="Required configuration value PINGONE_BASE_URL"):
                manager.load_config()
    
    def test_export_config_template(self):
        """Test exporting configuration template."""
        with tempfile.TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "test_config.env"
            
            manager = ConfigManager()
            manager.export_config_template("development", output_path)
            
            content = output_path.read_text()
            assert "ENVIRONMENT=development" in content
            assert "DEBUG=true" in content
            assert "LOG_LEVEL=DEBUG" in content
            assert "PINGONE_BASE_URL=https://your-tenant.forgeblocks.com" in content
    
    def test_save_config_to_file(self):
        """Test saving configuration to file with sensitive data redacted."""
        env_vars = {
            "ENVIRONMENT": "development",
            "PINGONE_BASE_URL": "https://test.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://test.forgeblocks.com/register",
            "PINGONE_TOKEN_ENDPOINT": "https://test.forgeblocks.com/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "https://test.forgeblocks.com/auth",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/callback",
            "OPENAI_API_KEY": "secret-openai-key",
        }
        
        with patch.dict(os.environ, env_vars, clear=True):
            manager = ConfigManager()
            config = manager.load_config()
            
            with tempfile.TemporaryDirectory() as temp_dir:
                output_path = Path(temp_dir) / "config.json"
                manager.save_config_to_file(config, output_path)
                
                with open(output_path) as f:
                    saved_config = json.load(f)
                
                # Sensitive data should be redacted
                assert saved_config["langchain"]["openai_api_key"] == "[REDACTED]"
                
                # Non-sensitive data should be preserved
                assert saved_config["environment"] == "development"
                assert saved_config["pingone"]["base_url"] == "https://test.forgeblocks.com"
    
    def test_reload_config(self):
        """Test configuration reloading."""
        env_vars = {
            "ENVIRONMENT": "development",
            "DEBUG": "true",
            "PINGONE_BASE_URL": "https://test.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://test.forgeblocks.com/register",
            "PINGONE_TOKEN_ENDPOINT": "https://test.forgeblocks.com/token",
            "PINGONE_AUTHORIZATION_ENDPOINT": "https://test.forgeblocks.com/auth",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/callback",
            "OPENAI_API_KEY": "test-openai-key",
        }
        
        with patch.dict(os.environ, env_vars, clear=True):
            manager = ConfigManager()
            config1 = manager.load_config()
            assert config1.debug is True
            
            # Change environment variable
            os.environ["DEBUG"] = "false"
            
            # Reload should pick up the change
            config2 = manager.reload_config()
            assert config2.debug is False
    
    def test_invalid_environment(self):
        """Test error handling for invalid environment."""
        manager = ConfigManager()
        
        with pytest.raises(ValueError, match="Unknown environment: invalid"):
            manager.load_config("invalid")
    
    def test_invalid_config_file(self):
        """Test error handling for invalid config file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("invalid json content")
            config_file_path = Path(f.name)
        
        try:
            manager = ConfigManager(config_file=config_file_path)
            with pytest.raises(ValueError, match="Failed to load configuration file"):
                manager.load_config()
        finally:
            config_file_path.unlink()


class TestMCPServerConfigs:
    """Test MCP server configuration loading."""
    
    def test_get_mcp_server_configs(self):
        """Test loading MCP server configurations from environment."""
        env_vars = {
            "MCP_SERVER_EXAMPLE_ENDPOINT": "ws://localhost:3001",
            "MCP_SERVER_EXAMPLE_CAPABILITIES": "read,write,execute",
            "MCP_SERVER_EXAMPLE_AUTH_REQUIRED": "true",
            "MCP_SERVER_ANOTHER_ENDPOINT": "ws://localhost:3002",
            "MCP_SERVER_ANOTHER_CAPABILITIES": "read",
            "MCP_SERVER_ANOTHER_AUTH_REQUIRED": "false",
        }
        
        with patch.dict(os.environ, env_vars, clear=True):
            manager = ConfigManager()
            configs = manager.get_mcp_server_configs()
            
            assert "example" in configs
            assert configs["example"]["endpoint"] == "ws://localhost:3001"
            assert configs["example"]["capabilities"] == ["read", "write", "execute"]
            assert configs["example"]["auth_required"] is True
            
            assert "another" in configs
            assert configs["another"]["endpoint"] == "ws://localhost:3002"
            assert configs["another"]["capabilities"] == ["read"]
            assert configs["another"]["auth_required"] is False



class TestSkipTokenSignatureValidationGuard:
    """Tests for SKIP_TOKEN_SIGNATURE_VALIDATION production guard (Phase 279)."""

    _BASE_ENV = {
        "PINGONE_BASE_URL": "https://auth.pingone.com/test/as",
        "PINGONE_CLIENT_REGISTRATION_ENDPOINT": "https://auth.pingone.com/test/as/register",
        "PINGONE_TOKEN_ENDPOINT": "https://auth.pingone.com/test/as/token",
        "PINGONE_AUTHORIZATION_ENDPOINT": "https://auth.pingone.com/test/as/authorize",
        "PINGONE_REDIRECT_URI": "https://api.ping.demo:4000/callback",
    }

    def test_guard_fires_in_staging(self):
        """SKIP_TOKEN_SIGNATURE_VALIDATION=true + staging → RuntimeError at startup."""
        env = {**self._BASE_ENV, "ENVIRONMENT": "staging", "SKIP_TOKEN_SIGNATURE_VALIDATION": "true"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(RuntimeError, match="SKIP_TOKEN_SIGNATURE_VALIDATION"):
                ConfigManager().load_config()

    def test_guard_fires_in_production(self):
        """SKIP_TOKEN_SIGNATURE_VALIDATION=true + production → RuntimeError at startup."""
        env = {**self._BASE_ENV, "ENVIRONMENT": "production", "SKIP_TOKEN_SIGNATURE_VALIDATION": "true"}
        with patch.dict(os.environ, env, clear=True):
            with pytest.raises(RuntimeError, match="SKIP_TOKEN_SIGNATURE_VALIDATION"):
                ConfigManager().load_config()

    def test_guard_allows_development(self):
        """SKIP_TOKEN_SIGNATURE_VALIDATION=true + development → no RuntimeError from guard."""
        env = {
            **self._BASE_ENV,
            "ENVIRONMENT": "development",
            "SKIP_TOKEN_SIGNATURE_VALIDATION": "true",
            "PINGONE_REDIRECT_URI": "http://localhost:4000/callback",
        }
        with patch.dict(os.environ, env, clear=True):
            try:
                ConfigManager().load_config()
            except RuntimeError as e:
                if "SKIP_TOKEN_SIGNATURE_VALIDATION" in str(e):
                    raise AssertionError(f"Guard must not fire in development: {e}") from e
                # Other RuntimeErrors (unrelated) are acceptable
            except Exception:
                pass  # Other errors (e.g. ValueError) are fine — guard didn't fire

    def test_guard_absent_when_flag_false(self):
        """SKIP_TOKEN_SIGNATURE_VALIDATION=false + production → no RuntimeError from guard."""
        env = {**self._BASE_ENV, "ENVIRONMENT": "production", "SKIP_TOKEN_SIGNATURE_VALIDATION": "false"}
        with patch.dict(os.environ, env, clear=True):
            try:
                ConfigManager().load_config()
            except RuntimeError as e:
                if "SKIP_TOKEN_SIGNATURE_VALIDATION" in str(e):
                    raise AssertionError(f"Guard must not fire when flag is false: {e}") from e
            except Exception:
                pass  # ValueError from prod validators is expected and fine
