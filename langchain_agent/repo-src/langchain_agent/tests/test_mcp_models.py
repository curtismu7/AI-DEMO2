"""Unit tests for MCP integration data models"""

import pytest
from datetime import datetime, timezone, timedelta
from src.models.mcp import (
    AuthRequirements,
    MCPServerConfig,
    AuthChallenge,
    MCPToolCall,
    AuthRequirementType,
    ChallengeType
)
from src.models.auth import AccessToken, AuthorizationCode


class TestAuthRequirements:
    """Test cases for AuthRequirements dataclass"""
    
    def test_valid_auth_requirements(self):
        """Test creating valid auth requirements"""
        auth_req = AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN,
            scopes=["read", "write"]
        )
        
        assert auth_req.type == AuthRequirementType.AGENT_TOKEN
        assert auth_req.scopes == ["read", "write"]
    
    def test_auth_requirements_validation_invalid_type(self):
        """Test validation fails for invalid type"""
        with pytest.raises(ValueError, match="type must be an AuthRequirementType enum value"):
            AuthRequirements(
                type="invalid_type",
                scopes=["read"]
            )
    
    def test_auth_requirements_validation_invalid_scopes_type(self):
        """Test validation fails for non-list scopes"""
        with pytest.raises(ValueError, match="scopes must be a list"):
            AuthRequirements(
                type=AuthRequirementType.NONE,
                scopes="not_a_list"
            )
    
    def test_auth_requirements_validation_empty_scope(self):
        """Test validation fails for empty scope in list"""
        with pytest.raises(ValueError, match="all scopes must be non-empty strings"):
            AuthRequirements(
                type=AuthRequirementType.USER_AUTHORIZATION,
                scopes=["read", "", "write"]
            )
    
    def test_auth_requirements_validation_non_string_scope(self):
        """Test validation fails for non-string scope"""
        with pytest.raises(ValueError, match="all scopes must be non-empty strings"):
            AuthRequirements(
                type=AuthRequirementType.BOTH,
                scopes=["read", 123, "write"]
            )


class TestMCPServerConfig:
    """Test cases for MCPServerConfig dataclass"""
    
    def test_valid_mcp_server_config(self):
        """Test creating valid MCP server config"""
        auth_req = AuthRequirements(
            type=AuthRequirementType.AGENT_TOKEN,
            scopes=["api:read"]
        )
        
        config = MCPServerConfig(
            name="test-server",
            endpoint="https://api.example.com/mcp",
            capabilities=["search", "create", "update"],
            auth_requirements=auth_req
        )
        
        assert config.name == "test-server"
        assert config.endpoint == "https://api.example.com/mcp"
        assert config.capabilities == ["search", "create", "update"]
        assert config.auth_requirements == auth_req
        assert config.requires_agent_token()
        assert not config.requires_user_authorization()
    
    def test_mcp_server_config_validation_empty_name(self):
        """Test validation fails for empty name"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="name must be a non-empty string"):
            MCPServerConfig(
                name="",
                endpoint="https://api.example.com",
                capabilities=["search"],
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_invalid_name_format(self):
        """Test validation fails for invalid name format"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="name contains invalid characters"):
            MCPServerConfig(
                name="invalid name with spaces!",
                endpoint="https://api.example.com",
                capabilities=["search"],
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_empty_endpoint(self):
        """Test validation fails for empty endpoint"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="endpoint must be a non-empty string"):
            MCPServerConfig(
                name="test-server",
                endpoint="",
                capabilities=["search"],
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_invalid_endpoint_format(self):
        """Test validation fails for invalid endpoint format"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="endpoint must be a valid URL"):
            MCPServerConfig(
                name="test-server",
                endpoint="not-a-valid-url",
                capabilities=["search"],
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_invalid_capabilities_type(self):
        """Test validation fails for non-list capabilities"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="capabilities must be a list"):
            MCPServerConfig(
                name="test-server",
                endpoint="https://api.example.com",
                capabilities="not_a_list",
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_empty_capability(self):
        """Test validation fails for empty capability"""
        auth_req = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        
        with pytest.raises(ValueError, match="all capabilities must be non-empty strings"):
            MCPServerConfig(
                name="test-server",
                endpoint="https://api.example.com",
                capabilities=["search", "", "update"],
                auth_requirements=auth_req
            )
    
    def test_mcp_server_config_validation_invalid_auth_requirements(self):
        """Test validation fails for invalid auth_requirements"""
        with pytest.raises(ValueError, match="auth_requirements must be an AuthRequirements instance"):
            MCPServerConfig(
                name="test-server",
                endpoint="https://api.example.com",
                capabilities=["search"],
                auth_requirements="not_auth_requirements"
            )
    
    def test_mcp_server_config_requires_methods(self):
        """Test requires_agent_token and requires_user_authorization methods"""
        # Test NONE
        auth_req_none = AuthRequirements(type=AuthRequirementType.NONE, scopes=[])
        config_none = MCPServerConfig(
            name="test", endpoint="https://api.example.com", 
            capabilities=["search"], auth_requirements=auth_req_none
        )
        assert not config_none.requires_agent_token()
        assert not config_none.requires_user_authorization()
        
        # Test AGENT_TOKEN
        auth_req_agent = AuthRequirements(type=AuthRequirementType.AGENT_TOKEN, scopes=["api"])
        config_agent = MCPServerConfig(
            name="test", endpoint="https://api.example.com", 
            capabilities=["search"], auth_requirements=auth_req_agent
        )
        assert config_agent.requires_agent_token()
        assert not config_agent.requires_user_authorization()
        
        # Test USER_AUTHORIZATION
        auth_req_user = AuthRequirements(type=AuthRequirementType.USER_AUTHORIZATION, scopes=["user"])
        config_user = MCPServerConfig(
            name="test", endpoint="https://api.example.com", 
            capabilities=["search"], auth_requirements=auth_req_user
        )
        assert not config_user.requires_agent_token()
        assert config_user.requires_user_authorization()
        
        # Test BOTH
        auth_req_both = AuthRequirements(type=AuthRequirementType.BOTH, scopes=["api", "user"])
        config_both = MCPServerConfig(
            name="test", endpoint="https://api.example.com", 
            capabilities=["search"], auth_requirements=auth_req_both
        )
        assert config_both.requires_agent_token()
        assert config_both.requires_user_authorization()


class TestAuthChallenge:
    """Test cases for AuthChallenge dataclass"""
    
    def test_valid_auth_challenge(self):
        """Test creating valid auth challenge"""
        challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://auth.example.com/oauth/authorize",
            scope="read write",
            state="random_state_123"
        )
        
        assert challenge.challenge_type == "oauth_authorization_code"
        assert challenge.authorization_url == "https://auth.example.com/oauth/authorize"
        assert challenge.scope == "read write"
        assert challenge.state == "random_state_123"
        assert challenge.is_oauth_authorization_code()
    
    def test_auth_challenge_validation_empty_challenge_type(self):
        """Test validation fails for empty challenge_type"""
        with pytest.raises(ValueError, match="challenge_type must be a non-empty string"):
            AuthChallenge(
                challenge_type="",
                authorization_url="https://auth.example.com",
                scope="read",
                state="state123"
            )
    
    def test_auth_challenge_validation_invalid_challenge_type(self):
        """Test validation fails for invalid challenge_type"""
        with pytest.raises(ValueError, match="challenge_type must be one of"):
            AuthChallenge(
                challenge_type="invalid_challenge_type",
                authorization_url="https://auth.example.com",
                scope="read",
                state="state123"
            )
    
    def test_auth_challenge_validation_empty_authorization_url(self):
        """Test validation fails for empty authorization_url"""
        with pytest.raises(ValueError, match="authorization_url must be a non-empty string"):
            AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url="",
                scope="read",
                state="state123"
            )
    
    def test_auth_challenge_validation_invalid_authorization_url_format(self):
        """Test validation fails for invalid authorization_url format"""
        with pytest.raises(ValueError, match="authorization_url must be a valid HTTP/HTTPS URL"):
            AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url="not-a-valid-url",
                scope="read",
                state="state123"
            )
    
    def test_auth_challenge_validation_empty_scope(self):
        """Test validation fails for empty scope"""
        with pytest.raises(ValueError, match="scope must be a non-empty string"):
            AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url="https://auth.example.com",
                scope="",
                state="state123"
            )
    
    def test_auth_challenge_validation_empty_state(self):
        """Test validation fails for empty state"""
        with pytest.raises(ValueError, match="state must be a non-empty string"):
            AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url="https://auth.example.com",
                scope="read",
                state=""
            )
    
    def test_auth_challenge_validation_invalid_state_format(self):
        """Test validation fails for invalid state format"""
        with pytest.raises(ValueError, match="state contains invalid characters"):
            AuthChallenge(
                challenge_type="oauth_authorization_code",
                authorization_url="https://auth.example.com",
                scope="read",
                state="invalid state with spaces!"
            )
    
    def test_auth_challenge_is_oauth_authorization_code(self):
        """Test is_oauth_authorization_code method"""
        # OAuth authorization code challenge
        oauth_challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://auth.example.com",
            scope="read",
            state="state123"
        )
        assert oauth_challenge.is_oauth_authorization_code()
        
        # Client credentials challenge
        client_challenge = AuthChallenge(
            challenge_type="oauth_client_credentials",
            authorization_url="https://auth.example.com",
            scope="read",
            state="state123"
        )
        assert not client_challenge.is_oauth_authorization_code()


class TestMCPToolCall:
    """Test cases for MCPToolCall dataclass"""
    
    def test_valid_mcp_tool_call(self):
        """Test creating valid MCP tool call"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123",
            token_type="Bearer",
            expires_in=3600,
            scope="api:read",
            issued_at=issued_at
        )
        
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        user_auth_code = AuthorizationCode(
            code="user_code_456",
            state="state_789",
            session_id="session_123",
            expires_at=expires_at
        )
        
        tool_call = MCPToolCall(
            tool_name="search.query",
            parameters={"query": "test", "limit": 10},
            agent_token=agent_token,
            user_auth_code=user_auth_code,
            session_id="session_123"
        )
        
        assert tool_call.tool_name == "search.query"
        assert tool_call.parameters == {"query": "test", "limit": 10}
        assert tool_call.agent_token == agent_token
        assert tool_call.user_auth_code == user_auth_code
        assert tool_call.session_id == "session_123"
        assert tool_call.has_user_authorization()
        assert not tool_call.is_agent_token_expired()
        assert not tool_call.is_user_auth_code_expired()
    
    def test_mcp_tool_call_without_user_auth_code(self):
        """Test MCP tool call without user authorization code"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123",
            token_type="Bearer",
            expires_in=3600,
            scope="api:read",
            issued_at=issued_at
        )
        
        tool_call = MCPToolCall(
            tool_name="search.query",
            parameters={"query": "test"},
            agent_token=agent_token,
            user_auth_code=None,
            session_id="session_123"
        )
        
        assert not tool_call.has_user_authorization()
        assert not tool_call.is_user_auth_code_expired()
    
    def test_mcp_tool_call_validation_empty_tool_name(self):
        """Test validation fails for empty tool_name"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="tool_name must be a non-empty string"):
            MCPToolCall(
                tool_name="",
                parameters={},
                agent_token=agent_token,
                user_auth_code=None,
                session_id="session_123"
            )
    
    def test_mcp_tool_call_validation_invalid_tool_name_format(self):
        """Test validation fails for invalid tool_name format"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="tool_name contains invalid characters"):
            MCPToolCall(
                tool_name="invalid tool name with spaces!",
                parameters={},
                agent_token=agent_token,
                user_auth_code=None,
                session_id="session_123"
            )
    
    def test_mcp_tool_call_validation_invalid_parameters_type(self):
        """Test validation fails for non-dict parameters"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="parameters must be a dictionary"):
            MCPToolCall(
                tool_name="search.query",
                parameters="not_a_dict",
                agent_token=agent_token,
                user_auth_code=None,
                session_id="session_123"
            )
    
    def test_mcp_tool_call_validation_invalid_agent_token(self):
        """Test validation fails for invalid agent_token"""
        with pytest.raises(ValueError, match="agent_token must be an AccessToken instance"):
            MCPToolCall(
                tool_name="search.query",
                parameters={},
                agent_token="not_an_access_token",
                user_auth_code=None,
                session_id="session_123"
            )
    
    def test_mcp_tool_call_validation_invalid_user_auth_code(self):
        """Test validation fails for invalid user_auth_code"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="user_auth_code must be an AuthorizationCode instance or None"):
            MCPToolCall(
                tool_name="search.query",
                parameters={},
                agent_token=agent_token,
                user_auth_code="not_an_auth_code",
                session_id="session_123"
            )
    
    def test_mcp_tool_call_validation_empty_session_id(self):
        """Test validation fails for empty session_id"""
        issued_at = datetime.now(timezone.utc)
        agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            MCPToolCall(
                tool_name="search.query",
                parameters={},
                agent_token=agent_token,
                user_auth_code=None,
                session_id=""
            )
    
    def test_mcp_tool_call_expired_tokens(self):
        """Test expiration checks for tokens"""
        # Expired agent token
        old_issued_at = datetime.now(timezone.utc) - timedelta(hours=2)
        expired_agent_token = AccessToken(
            token="agent_token_123", token_type="Bearer",
            expires_in=3600, scope="api:read", issued_at=old_issued_at
        )
        
        # Expired user auth code
        expired_time = datetime.now(timezone.utc) - timedelta(minutes=5)
        expired_user_auth_code = AuthorizationCode(
            code="user_code_456", state="state_789",
            session_id="session_123", expires_at=expired_time
        )
        
        tool_call = MCPToolCall(
            tool_name="search.query",
            parameters={},
            agent_token=expired_agent_token,
            user_auth_code=expired_user_auth_code,
            session_id="session_123"
        )
        
        assert tool_call.is_agent_token_expired()
        assert tool_call.is_user_auth_code_expired()