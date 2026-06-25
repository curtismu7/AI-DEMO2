"""Unit tests for authentication data models"""

import pytest
from datetime import datetime, timezone, timedelta
from src.models.auth import (
    ClientCredentials,
    AccessToken,
    AuthorizationCode,
    AgentTokenContext,
    TokenType
)


class TestClientCredentials:
    """Test cases for ClientCredentials dataclass"""
    
    def test_valid_client_credentials(self):
        """Test creating valid client credentials"""
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        credentials = ClientCredentials(
            client_id="test_client_id",
            client_secret="test_client_secret",
            registration_access_token="test_reg_token",
            expires_at=expires_at
        )
        
        assert credentials.client_id == "test_client_id"
        assert credentials.client_secret == "test_client_secret"
        assert credentials.registration_access_token == "test_reg_token"
        assert credentials.expires_at == expires_at
        assert not credentials.is_expired()
    
    def test_client_credentials_validation_empty_client_id(self):
        """Test validation fails for empty client_id"""
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        
        with pytest.raises(ValueError, match="client_id must be a non-empty string"):
            ClientCredentials(
                client_id="",
                client_secret="test_secret",
                registration_access_token="test_token",
                expires_at=expires_at
            )
    
    def test_client_credentials_validation_empty_client_secret(self):
        """Test validation fails for empty client_secret"""
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        
        with pytest.raises(ValueError, match="client_secret must be a non-empty string"):
            ClientCredentials(
                client_id="test_id",
                client_secret="",
                registration_access_token="test_token",
                expires_at=expires_at
            )
    
    def test_client_credentials_validation_empty_registration_token(self):
        """Test validation fails for empty registration_access_token"""
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        
        with pytest.raises(ValueError, match="registration_access_token must be a non-empty string"):
            ClientCredentials(
                client_id="test_id",
                client_secret="test_secret",
                registration_access_token="",
                expires_at=expires_at
            )
    
    def test_client_credentials_validation_invalid_expires_at(self):
        """Test validation fails for invalid expires_at"""
        with pytest.raises(ValueError, match="expires_at must be a datetime object"):
            ClientCredentials(
                client_id="test_id",
                client_secret="test_secret",
                registration_access_token="test_token",
                expires_at="not_a_datetime"
            )
    
    def test_client_credentials_is_expired(self):
        """Test expiration check"""
        # Expired credentials
        expired_time = datetime.now(timezone.utc) - timedelta(hours=1)
        expired_credentials = ClientCredentials(
            client_id="test_id",
            client_secret="test_secret",
            registration_access_token="test_token",
            expires_at=expired_time
        )
        assert expired_credentials.is_expired()
        
        # Valid credentials
        future_time = datetime.now(timezone.utc) + timedelta(hours=1)
        valid_credentials = ClientCredentials(
            client_id="test_id",
            client_secret="test_secret",
            registration_access_token="test_token",
            expires_at=future_time
        )
        assert not valid_credentials.is_expired()
    
    def test_client_credentials_expires_in_seconds(self):
        """Test expires_in_seconds calculation"""
        future_time = datetime.now(timezone.utc) + timedelta(seconds=3600)
        credentials = ClientCredentials(
            client_id="test_id",
            client_secret="test_secret",
            registration_access_token="test_token",
            expires_at=future_time
        )
        
        expires_in = credentials.expires_in_seconds()
        assert 3590 <= expires_in <= 3600  # Allow for small timing differences


class TestAccessToken:
    """Test cases for AccessToken dataclass"""
    
    def test_valid_access_token(self):
        """Test creating valid access token"""
        issued_at = datetime.now(timezone.utc)
        token = AccessToken(
            token="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=issued_at
        )
        
        assert token.token == "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        assert token.token_type == "Bearer"
        assert token.expires_in == 3600
        assert token.scope == "read write"
        assert token.issued_at == issued_at
        assert not token.is_expired()
    
    def test_access_token_validation_empty_token(self):
        """Test validation fails for empty token"""
        issued_at = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="token must be a non-empty string"):
            AccessToken(
                token="",
                token_type="Bearer",
                expires_in=3600,
                scope="read",
                issued_at=issued_at
            )
    
    def test_access_token_validation_invalid_token_format(self):
        """Test validation fails for invalid token format"""
        issued_at = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="token contains invalid characters"):
            AccessToken(
                token="invalid token with spaces!",
                token_type="Bearer",
                expires_in=3600,
                scope="read",
                issued_at=issued_at
            )
    
    def test_access_token_validation_empty_token_type(self):
        """Test validation fails for empty token_type"""
        issued_at = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="token_type must be a non-empty string"):
            AccessToken(
                token="valid_token",
                token_type="",
                expires_in=3600,
                scope="read",
                issued_at=issued_at
            )
    
    def test_access_token_validation_invalid_expires_in(self):
        """Test validation fails for invalid expires_in"""
        issued_at = datetime.now(timezone.utc)
        
        with pytest.raises(ValueError, match="expires_in must be a positive integer"):
            AccessToken(
                token="valid_token",
                token_type="Bearer",
                expires_in=0,
                scope="read",
                issued_at=issued_at
            )
    
    def test_access_token_validation_empty_scope(self):
        """Empty scope is allowed (PingOne returns scope="" for some
        client-credentials tokens); only non-string scope is rejected."""
        issued_at = datetime.now(timezone.utc)

        token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="",
            issued_at=issued_at
        )
        assert token.scope == ""

        with pytest.raises(ValueError, match="scope must be a string"):
            AccessToken(
                token="valid_token",
                token_type="Bearer",
                expires_in=3600,
                scope=None,
                issued_at=issued_at
            )
    
    def test_access_token_validation_invalid_issued_at(self):
        """Test validation fails for invalid issued_at"""
        with pytest.raises(ValueError, match="issued_at must be a datetime object"):
            AccessToken(
                token="valid_token",
                token_type="Bearer",
                expires_in=3600,
                scope="read",
                issued_at="not_a_datetime"
            )
    
    def test_access_token_token_type_normalization(self):
        """Test token type normalization"""
        issued_at = datetime.now(timezone.utc)
        token = AccessToken(
            token="valid_token",
            token_type="bearer",  # lowercase
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        assert token.token_type == "Bearer"
    
    def test_access_token_is_expired(self):
        """Test expiration check"""
        # Expired token
        old_issued_at = datetime.now(timezone.utc) - timedelta(hours=2)
        expired_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,  # 1 hour
            scope="read",
            issued_at=old_issued_at
        )
        assert expired_token.is_expired()
        
        # Valid token
        recent_issued_at = datetime.now(timezone.utc)
        valid_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=recent_issued_at
        )
        assert not valid_token.is_expired()
    
    def test_access_token_expires_at(self):
        """Test expires_at calculation"""
        issued_at = datetime.now(timezone.utc)
        token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        expected_expiry = issued_at + timedelta(seconds=3600)
        assert token.expires_at() == expected_expiry
    
    def test_access_token_expires_in_seconds(self):
        """Test expires_in_seconds calculation"""
        issued_at = datetime.now(timezone.utc)
        token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        expires_in = token.expires_in_seconds()
        assert 3590 <= expires_in <= 3600  # Allow for small timing differences
    
    def test_access_token_authorization_header(self):
        """Test authorization header generation"""
        issued_at = datetime.now(timezone.utc)
        token = AccessToken(
            token="test_token_123",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        assert token.authorization_header() == "Bearer test_token_123"


class TestAuthorizationCode:
    """Test cases for AuthorizationCode dataclass"""
    
    def test_valid_authorization_code(self):
        """Test creating valid authorization code"""
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        auth_code = AuthorizationCode(
            code="auth_code_123",
            state="random_state_456",
            session_id="session_789",
            expires_at=expires_at
        )
        
        assert auth_code.code == "auth_code_123"
        assert auth_code.state == "random_state_456"
        assert auth_code.session_id == "session_789"
        assert auth_code.expires_at == expires_at
        assert not auth_code.is_expired()
    
    def test_authorization_code_validation_empty_code(self):
        """Test validation fails for empty code"""
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        with pytest.raises(ValueError, match="code must be a non-empty string"):
            AuthorizationCode(
                code="",
                state="state",
                session_id="session",
                expires_at=expires_at
            )
    
    def test_authorization_code_validation_invalid_code_format(self):
        """Test validation fails for invalid code format"""
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        with pytest.raises(ValueError, match="code contains invalid characters"):
            AuthorizationCode(
                code="invalid code with spaces!",
                state="state",
                session_id="session",
                expires_at=expires_at
            )
    
    def test_authorization_code_validation_empty_state(self):
        """Test validation fails for empty state"""
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        with pytest.raises(ValueError, match="state must be a non-empty string"):
            AuthorizationCode(
                code="valid_code",
                state="",
                session_id="session",
                expires_at=expires_at
            )
    
    def test_authorization_code_validation_empty_session_id(self):
        """Test validation fails for empty session_id"""
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            AuthorizationCode(
                code="valid_code",
                state="state",
                session_id="",
                expires_at=expires_at
            )
    
    def test_authorization_code_validation_invalid_expires_at(self):
        """Test validation fails for invalid expires_at"""
        with pytest.raises(ValueError, match="expires_at must be a datetime object"):
            AuthorizationCode(
                code="valid_code",
                state="state",
                session_id="session",
                expires_at="not_a_datetime"
            )
    
    def test_authorization_code_is_expired(self):
        """Test expiration check"""
        # Expired code
        expired_time = datetime.now(timezone.utc) - timedelta(minutes=5)
        expired_code = AuthorizationCode(
            code="valid_code",
            state="state",
            session_id="session",
            expires_at=expired_time
        )
        assert expired_code.is_expired()
        
        # Valid code
        future_time = datetime.now(timezone.utc) + timedelta(minutes=10)
        valid_code = AuthorizationCode(
            code="valid_code",
            state="state",
            session_id="session",
            expires_at=future_time
        )
        assert not valid_code.is_expired()
    
    def test_authorization_code_expires_in_seconds(self):
        """Test expires_in_seconds calculation"""
        future_time = datetime.now(timezone.utc) + timedelta(seconds=600)
        auth_code = AuthorizationCode(
            code="valid_code",
            state="state",
            session_id="session",
            expires_at=future_time
        )
        
        expires_in = auth_code.expires_in_seconds()
        assert 590 <= expires_in <= 600  # Allow for small timing differences


class TestAgentTokenContext:
    """Test cases for AgentTokenContext dataclass"""
    
    def test_valid_agent_token_context(self):
        """Test creating valid agent token context"""
        issued_at = datetime.now(timezone.utc)
        access_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        context = AgentTokenContext(
            agent_token=access_token,
            session_id="session_123"
        )
        
        assert context.agent_token == access_token
        assert context.session_id == "session_123"
        assert not context.is_token_expired()
    
    def test_agent_token_context_validation_invalid_agent_token(self):
        """Test validation fails for invalid agent_token"""
        with pytest.raises(ValueError, match="agent_token must be an AccessToken instance"):
            AgentTokenContext(
                agent_token="not_an_access_token",
                session_id="session_123"
            )
    
    def test_agent_token_context_validation_empty_session_id(self):
        """Test validation fails for empty session_id"""
        issued_at = datetime.now(timezone.utc)
        access_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=issued_at
        )
        
        with pytest.raises(ValueError, match="session_id must be a non-empty string"):
            AgentTokenContext(
                agent_token=access_token,
                session_id=""
            )
    
    def test_agent_token_context_is_token_expired(self):
        """Test token expiration check through context"""
        # Expired token
        old_issued_at = datetime.now(timezone.utc) - timedelta(hours=2)
        expired_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=old_issued_at
        )
        
        expired_context = AgentTokenContext(
            agent_token=expired_token,
            session_id="session_123"
        )
        assert expired_context.is_token_expired()
        
        # Valid token
        recent_issued_at = datetime.now(timezone.utc)
        valid_token = AccessToken(
            token="valid_token",
            token_type="Bearer",
            expires_in=3600,
            scope="read",
            issued_at=recent_issued_at
        )
        
        valid_context = AgentTokenContext(
            agent_token=valid_token,
            session_id="session_123"
        )
        assert not valid_context.is_token_expired()