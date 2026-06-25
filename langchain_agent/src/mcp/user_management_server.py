"""
MCP Server for User Management (User Lookup and Account Registration).

This server provides tools for:
1. user_lookup - Search for existing users by email address
2. account_registration - Register new user accounts
"""
import asyncio
import json
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
import uuid

from models.auth import AccessToken, AuthorizationCode


logger = logging.getLogger(__name__)


class UserManagementMCPServer:
    """MCP Server implementation for user management operations."""
    
    def __init__(self):
        self.name = "user_management"
        self.version = "1.0.0"
        
        # In-memory user storage (in production, this would be a database)
        self._users: Dict[str, Dict[str, Any]] = {}
        
        # Tool definitions
        self._tools = {
            "user_lookup": {
                "name": "user_lookup",
                "description": "Search for existing users by email address",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "email": {
                            "type": "string",
                            "description": "Email address to search for"
                        }
                    },
                    "required": ["email"]
                }
            },
            "account_registration": {
                "name": "account_registration",
                "description": "Register a new user account with the banking system",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "email": {
                            "type": "string",
                            "description": "User's email address"
                        },
                        "first_name": {
                            "type": "string",
                            "description": "User's first name"
                        },
                        "last_name": {
                            "type": "string",
                            "description": "User's last name"
                        },
                        "phone": {
                            "type": "string",
                            "description": "User's phone number"
                        },
                        "date_of_birth": {
                            "type": "string",
                            "description": "User's date of birth (YYYY-MM-DD format)"
                        },
                        "address": {
                            "type": "object",
                            "properties": {
                                "street": {"type": "string"},
                                "city": {"type": "string"},
                                "state": {"type": "string"},
                                "zip_code": {"type": "string"},
                                "country": {"type": "string"}
                            },
                            "required": ["street", "city", "state", "zip_code", "country"]
                        }
                    },
                    "required": ["email", "first_name", "last_name", "phone", "date_of_birth", "address"]
                }
            }
        }
        
        logger.info(f"Initialized {self.name} MCP server v{self.version}")
    
    async def list_tools(self) -> List[str]:
        """List available tools."""
        return list(self._tools.keys())
    
    async def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get schema for a specific tool."""
        return self._tools.get(tool_name)
    
    async def call_tool(self, tool_name: str, parameters: Dict[str, Any], 
                       agent_token: Optional[AccessToken] = None,
                       user_auth_code: Optional[AuthorizationCode] = None,
                       session_id: Optional[str] = None) -> Dict[str, Any]:
        """Execute a tool call."""
        
        # Validate agent token has ai_agent scope
        if not agent_token:
            return {
                "error": "Agent token required for user management operations",
                "type": "auth_error"
            }
        
        if agent_token.is_expired():
            return {
                "error": "Agent token has expired",
                "type": "auth_error"
            }
        
        # Check if agent token has ai_agent scope
        if "ai_agent" not in agent_token.scope.split():
            return {
                "error": "Agent token missing required 'ai_agent' scope",
                "type": "auth_error"
            }
        
        logger.info(f"Executing tool {tool_name} with ai_agent scope")
        
        if tool_name == "user_lookup":
            return await self._user_lookup(parameters)
        elif tool_name == "account_registration":
            return await self._account_registration(parameters)
        else:
            return {
                "error": f"Unknown tool: {tool_name}",
                "type": "tool_error"
            }
    
    async def _user_lookup(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Look up a user by email address."""
        try:
            email = parameters.get("email", "").lower().strip()
            
            if not email:
                return {
                    "error": "Email address is required",
                    "type": "validation_error"
                }
            
            # Validate email format
            if "@" not in email or "." not in email.split("@")[1]:
                return {
                    "error": "Invalid email format",
                    "type": "validation_error"
                }
            
            # Check if user exists
            user = self._users.get(email)
            
            if user:
                # Return user existence and basic info (no sensitive data)
                return {
                    "content": [{
                        "type": "text",
                        "text": json.dumps({
                            "user_exists": True,
                            "user_id": user["user_id"],
                            "email": user["email"],
                            "first_name": user["first_name"],
                            "last_name": user["last_name"],
                            "registration_date": user["registration_date"],
                            "account_status": user.get("account_status", "active")
                        }, indent=2)
                    }]
                }
            else:
                return {
                    "content": [{
                        "type": "text",
                        "text": json.dumps({
                            "user_exists": False,
                            "email": email,
                            "message": "No user found with this email address"
                        }, indent=2)
                    }]
                }
                
        except Exception as e:
            logger.error(f"Error in user_lookup: {e}")
            return {
                "error": f"User lookup failed: {str(e)}",
                "type": "server_error"
            }
    
    async def _account_registration(self, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Register a new user account."""
        try:
            # Extract and validate parameters
            email = parameters.get("email", "").lower().strip()
            first_name = parameters.get("first_name", "").strip()
            last_name = parameters.get("last_name", "").strip()
            phone = parameters.get("phone", "").strip()
            date_of_birth = parameters.get("date_of_birth", "").strip()
            address = parameters.get("address", {})
            
            # Validation
            validation_errors = []
            
            if not email:
                validation_errors.append("Email address is required")
            elif "@" not in email or "." not in email.split("@")[1]:
                validation_errors.append("Invalid email format")
            elif email in self._users:
                validation_errors.append("User with this email already exists")
            
            if not first_name:
                validation_errors.append("First name is required")
            
            if not last_name:
                validation_errors.append("Last name is required")
            
            if not phone:
                validation_errors.append("Phone number is required")
            
            if not date_of_birth:
                validation_errors.append("Date of birth is required")
            else:
                # Validate date format
                try:
                    datetime.strptime(date_of_birth, "%Y-%m-%d")
                except ValueError:
                    validation_errors.append("Date of birth must be in YYYY-MM-DD format")
            
            # Validate address
            if not isinstance(address, dict):
                validation_errors.append("Address must be an object")
            else:
                required_address_fields = ["street", "city", "state", "zip_code", "country"]
                for field in required_address_fields:
                    if not address.get(field, "").strip():
                        validation_errors.append(f"Address {field} is required")
            
            if validation_errors:
                return {
                    "error": "Validation failed",
                    "validation_errors": validation_errors,
                    "type": "validation_error"
                }
            
            # Create new user
            user_id = str(uuid.uuid4())
            registration_date = datetime.now(timezone.utc).isoformat()
            
            user_data = {
                "user_id": user_id,
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "phone": phone,
                "date_of_birth": date_of_birth,
                "address": address,
                "registration_date": registration_date,
                "account_status": "active",
                "created_by": "ai_agent"
            }
            
            # Store user
            self._users[email] = user_data
            
            logger.info(f"Successfully registered new user: {email}")
            
            # Return success response with account details
            return {
                "content": [{
                    "type": "text",
                    "text": json.dumps({
                        "registration_successful": True,
                        "user_id": user_id,
                        "email": email,
                        "first_name": first_name,
                        "last_name": last_name,
                        "registration_date": registration_date,
                        "account_status": "active",
                        "message": "Account successfully created! You can now access banking services."
                    }, indent=2)
                }]
            }
            
        except Exception as e:
            logger.error(f"Error in account_registration: {e}")
            return {
                "error": f"Account registration failed: {str(e)}",
                "type": "server_error"
            }
    
    async def get_server_info(self) -> Dict[str, Any]:
        """Get server information."""
        return {
            "name": self.name,
            "version": self.version,
            "description": "User Management MCP Server for user lookup and account registration",
            "tools": list(self._tools.keys()),
            "capabilities": ["user_lookup", "account_registration"],
            "auth_requirements": {
                "agent_token_required": True,
                "required_scopes": ["ai_agent"]
            }
        }
    
    def get_registered_users_count(self) -> int:
        """Get the number of registered users (for testing/debugging)."""
        return len(self._users)
    
    def clear_users(self) -> None:
        """Clear all users (for testing)."""
        self._users.clear()
        logger.info("Cleared all users from memory")