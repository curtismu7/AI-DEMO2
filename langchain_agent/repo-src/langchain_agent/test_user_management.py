#!/usr/bin/env python3
"""
Test script for user management MCP server and AI agent integration.
"""
import asyncio
import logging
import sys
from pathlib import Path

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from mcp.user_management_server import UserManagementMCPServer
from models.auth import AccessToken
from datetime import datetime, timezone, timedelta


# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def test_user_management_server():
    """Test the user management MCP server."""
    logger.info("Testing User Management MCP Server")
    
    # Create server instance
    server = UserManagementMCPServer()
    
    # Create a mock agent token with ai_agent scope
    agent_token = AccessToken(
        token="test_agent_token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile ai_agent",
        issued_at=datetime.now(timezone.utc)
    )
    
    # Test 1: List tools
    logger.info("Test 1: Listing available tools")
    tools = await server.list_tools()
    logger.info(f"Available tools: {tools}")
    assert "user_lookup" in tools
    assert "account_registration" in tools
    
    # Test 2: Get tool schemas
    logger.info("Test 2: Getting tool schemas")
    user_lookup_schema = await server.get_tool_schema("user_lookup")
    logger.info(f"User lookup schema: {user_lookup_schema}")
    
    account_reg_schema = await server.get_tool_schema("account_registration")
    logger.info(f"Account registration schema: {account_reg_schema}")
    
    # Test 3: User lookup for non-existent user
    logger.info("Test 3: Looking up non-existent user")
    result = await server.call_tool(
        tool_name="user_lookup",
        parameters={"email": "test@example.com"},
        agent_token=agent_token,
        session_id="test_session_1"
    )
    logger.info(f"User lookup result: {result}")
    
    # Test 4: Register a new user
    logger.info("Test 4: Registering a new user")
    registration_params = {
        "email": "test@example.com",
        "first_name": "John",
        "last_name": "Doe",
        "phone": "+1-555-123-4567",
        "date_of_birth": "1990-01-15",
        "address": {
            "street": "123 Main St",
            "city": "Anytown",
            "state": "CA",
            "zip_code": "12345",
            "country": "USA"
        }
    }
    
    result = await server.call_tool(
        tool_name="account_registration",
        parameters=registration_params,
        agent_token=agent_token,
        session_id="test_session_1"
    )
    logger.info(f"Registration result: {result}")
    
    # Test 5: User lookup for existing user
    logger.info("Test 5: Looking up existing user")
    result = await server.call_tool(
        tool_name="user_lookup",
        parameters={"email": "test@example.com"},
        agent_token=agent_token,
        session_id="test_session_1"
    )
    logger.info(f"User lookup result: {result}")
    
    # Test 6: Try to register duplicate user
    logger.info("Test 6: Attempting to register duplicate user")
    result = await server.call_tool(
        tool_name="account_registration",
        parameters=registration_params,
        agent_token=agent_token,
        session_id="test_session_1"
    )
    logger.info(f"Duplicate registration result: {result}")
    
    # Test 7: Test without agent token (should fail)
    logger.info("Test 7: Testing without agent token")
    result = await server.call_tool(
        tool_name="user_lookup",
        parameters={"email": "test@example.com"},
        session_id="test_session_1"
    )
    logger.info(f"No token result: {result}")
    
    # Test 8: Test with token missing ai_agent scope
    logger.info("Test 8: Testing with token missing ai_agent scope")
    bad_token = AccessToken(
        token="test_bad_token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile",  # Missing ai_agent scope
        issued_at=datetime.now(timezone.utc)
    )
    
    result = await server.call_tool(
        tool_name="user_lookup",
        parameters={"email": "test@example.com"},
        agent_token=bad_token,
        session_id="test_session_1"
    )
    logger.info(f"Bad scope result: {result}")
    
    logger.info("✅ All tests completed successfully!")


async def main():
    """Main test function."""
    try:
        await test_user_management_server()
    except Exception as e:
        logger.error(f"Test failed: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())