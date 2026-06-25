"""
MCP Tool Provider for LangChain integration.
"""
import asyncio
import contextvars
import json
import logging
import traceback
from typing import Dict, Any, List, Optional, Type
from datetime import datetime

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr

from mcp.tool_registry import MCPClientManager, ToolInfo
from authentication.oauth_manager import OAuthAuthenticationManager
from models.auth import AccessToken, AuthorizationCode
from models.mcp import AuthChallenge


logger = logging.getLogger(__name__)

# WR-06: the "current tracer" must be scoped to the async context/task that
# set it, NOT shared process-wide. A module-level global was only safe while
# WR-02's single global message-queue worker serialized all session
# processing; the moment per-session concurrency is introduced, session A's
# tracer would receive session B's log_step calls (cross-session trace bleed).
# A ContextVar is the correct construct: asyncio.create_task copies the
# context at creation time, so each concurrent task sees its OWN tracer.
# Setter ordering is verified safe — set_tracer() runs BEFORE the tool
# execution (agent_executor.ainvoke / tool.arun) that reads it, so the value
# is captured into any child tasks the executor spawns (copy-on-create).
# The same pattern applies to _current_session_id_var and _current_agent_token_var — see Phase 273.
_current_tracer: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar(
    "mcp_current_tracer", default=None
)
_current_session_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "mcp_current_session_id", default=None
)
_current_agent_token_var: contextvars.ContextVar[Optional[Any]] = contextvars.ContextVar(
    "mcp_current_agent_token", default=None
)


# WR-05: the auth-popup block was previously assembled with bare f-string
# interpolation of values that originate from an MCP server's authChallenge
# payload (authorizationUrl, scope, expiresAt, ...). A value containing a
# double-quote or brace could break out of the hand-rolled "JSON" and inject
# arbitrary keys the UI then trusts (e.g. redirect the popup elsewhere).
# Build a real dict and json.dumps() it so every value is correctly escaped.
def build_auth_popup_message(
    *,
    auth_url: str,
    popup_width: Any,
    popup_height: Any,
    popup_title: str,
    status_endpoint: str,
    session_id: str,
    scope: str,
    expires_at: str,
) -> str:
    """Return the SYSTEM_AUTH_POPUP_REQUEST envelope with an injection-safe
    JSON body. Shared by the tool provider and the agent so all three former
    f-string sites have one correct implementation."""
    payload = {
        "authorizationUrl": auth_url,
        "popupWidth": popup_width,
        "popupHeight": popup_height,
        "popupTitle": popup_title,
        "statusEndpoint": status_endpoint,
        "sessionId": session_id,
        "scope": scope,
        "expiresAt": expires_at,
    }
    return (
        "SYSTEM_AUTH_POPUP_REQUEST_START\n"
        + json.dumps(payload, indent=2)
        + "\nSYSTEM_AUTH_POPUP_REQUEST_END\n\n"
        + "Authorization Required: I need your permission to access your "
        + "banking data. I'll open a secure popup window for you to "
        + "complete the authorization process."
    )


class MCPToolInput(BaseModel):
    """Base input schema for MCP tools."""
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters to pass to the MCP tool")


def create_tool_input_schema(tool_info: ToolInfo) -> Type[BaseModel]:
    """
    Create an input schema for an MCP tool from server-provided metadata first.

    Args:
        tool_info: Information about the MCP tool including parameters

    Returns:
        A Pydantic model class for the tool's input schema
    """
    if tool_info.parameters and isinstance(tool_info.parameters, dict):
        properties = tool_info.parameters.get("properties", {})
        required = tool_info.parameters.get("required", [])

        if properties:
            logger.debug("Schema source for %s: metadata", tool_info.full_name)
            return _create_schema_from_properties(tool_info, properties, required)

    # Metadata is absent or incomplete: use generic schema to avoid tool-specific drift.
    logger.debug("Schema source for %s: generic-fallback", tool_info.full_name)
    return MCPToolInput


def _create_schema_from_properties(tool_info: ToolInfo, properties: Dict[str, Any], required: List[str]) -> Type[BaseModel]:
    """Create a schema from MCP server properties."""
    
    # Create dynamic fields for the Pydantic model
    fields = {}
    
    for prop_name, prop_schema in properties.items():
        prop_type = prop_schema.get("type", "string")
        prop_description = prop_schema.get("description", f"Parameter {prop_name}")
        prop_default = prop_schema.get("default")
        
        # Map JSON Schema types to Python types
        if prop_type == "string":
            python_type = str
        elif prop_type == "number":
            python_type = float
        elif prop_type == "integer":
            python_type = int
        elif prop_type == "boolean":
            python_type = bool
        elif prop_type == "array":
            python_type = List[Any]
        elif prop_type == "object":
            python_type = Dict[str, Any]
        else:
            python_type = Any
        
        # Make field optional if not required
        if prop_name not in required:
            python_type = Optional[python_type]
            if prop_default is None:
                prop_default = None
        
        # Create Field with description
        if prop_default is not None:
            field_def = Field(default=prop_default, description=prop_description)
        elif prop_name not in required:
            field_def = Field(default=None, description=prop_description)
        else:
            field_def = Field(description=prop_description)
        
        fields[prop_name] = (python_type, field_def)
    
    # Create the dynamic model class
    class_name = f"{tool_info.server_name.title()}{tool_info.name.title()}Input"
    
    # Create the model with dynamic fields
    DynamicToolInput = type(class_name, (BaseModel,), {
        '__annotations__': {name: field_type for name, (field_type, _) in fields.items()},
        **{name: field_def for name, (_, field_def) in fields.items()}
    })
    
    logger.debug(f"Created dynamic input schema for {tool_info.full_name}: {class_name}")
    logger.debug(f"Schema fields: {list(fields.keys())}")
    
    return DynamicToolInput


def format_tool_response(content: str, tool_name: str) -> str:
    """Format a JSON tool response for user display. Returns content unchanged if not applicable."""
    try:
        if content.strip().startswith('{') and content.strip().endswith('}'):
            data = json.loads(content)
            if tool_name == "get_my_accounts" and "accounts" in data:
                return _fmt_accounts(data)
            elif tool_name == "get_account_balance" and "balance" in data:
                return _fmt_balance(data)
            elif tool_name == "get_my_transactions" and "transactions" in data:
                return _fmt_transactions(data)
            elif tool_name == "create_transfer" and "success" in data:
                return _fmt_transfer(data)
            elif tool_name == "create_deposit" and "success" in data:
                return _fmt_deposit(data)
            elif tool_name == "create_withdrawal" and "success" in data:
                return _fmt_withdrawal(data)
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.debug("Could not format as JSON: %s", e)
    return content


def _fmt_accounts(data: dict) -> str:
    if not data.get("success", False) or not data.get("accounts"):
        return "No accounts found or error retrieving accounts."
    accounts = data["accounts"]
    total_balance = sum(acc.get("balance", 0) for acc in accounts)
    session_id = _current_session_id_var.get()
    if session_id:
        account_ids = [acc.get("id") for acc in accounts if acc.get("id")]
        logger.info("Retrieved %d accounts with IDs %s for session %s", len(accounts), account_ids, session_id)
        logger.info("Account IDs are now visible to the LLM for future banking operations")
    response = f"**Your Bank Accounts** ({len(accounts)} accounts)\n\n"
    for i, account in enumerate(accounts, 1):
        account_type = account.get("type", "unknown").title()
        account_number = account.get("number", "N/A")
        balance = account.get("balance", 0)
        status = account.get("status", "unknown").title()
        account_id = account.get("id", "N/A")
        response += f"**{i}. {account_type} Account**\n"
        response += f"   • Account Number: {account_number}\n"
        response += f"   • Account ID: {account_id}\n"
        response += f"   • Balance: ${balance:,.2f}\n"
        response += f"   • Status: {status}\n\n"
    response += f"**Total Balance: ${total_balance:,.2f}**"
    return response


def _fmt_balance(data: dict) -> str:
    if not data.get("success", False):
        return "Error retrieving account balance."
    balance = data.get("balance", 0)
    account_type = data.get("account_type", "Account")
    account_number = data.get("account_number", "")
    response = f"**{account_type.title()} Balance**\n\n"
    if account_number:
        response += f"Account: {account_number}\n"
    response += f"Current Balance: **${balance:,.2f}**"
    return response


def _fmt_transactions(data: dict) -> str:
    if not data.get("success", False) or not data.get("transactions"):
        return "No transactions found or error retrieving transactions."
    transactions = data["transactions"]
    response = f"**Recent Transactions** ({len(transactions)} transactions)\n\n"
    for i, txn in enumerate(transactions[:10], 1):
        date = txn.get("date", "N/A")
        description = txn.get("description", "Transaction")
        amount = txn.get("amount", 0)
        txn_type = txn.get("type", "unknown")
        if amount > 0:
            amount_str = f"+${amount:,.2f}"
            emoji = ""
        else:
            amount_str = f"-${abs(amount):,.2f}"
            emoji = ""
        response += f"{emoji} **{description}**\n"
        response += f"   • Date: {date}\n"
        response += f"   • Amount: {amount_str}\n"
        response += f"   • Type: {txn_type.title()}\n\n"
    if len(transactions) > 10:
        response += f"... and {len(transactions) - 10} more transactions"
    return response


def _fmt_transfer(data: dict) -> str:
    if not data.get("success", False):
        error = data.get("error", "Transfer failed")
        return f"❌ **Transfer Failed**\n\n{error}"
    amount = data.get("amount", 0)
    from_account_id = data.get("fromAccountId", "N/A")
    to_account_id = data.get("toAccountId", "N/A")
    description = data.get("description", "Transfer")
    withdrawal_txn = data.get("withdrawalTransaction", {})
    deposit_txn = data.get("depositTransaction", {})
    withdrawal_id = withdrawal_txn.get("id", "N/A")
    deposit_id = deposit_txn.get("id", "N/A")
    response = f"✅ **Transfer Successful**\n\n"
    response += f"Amount: **${amount:,.2f}**\n"
    response += f"Description: {description}\n"
    response += f"From Account: {from_account_id}\n"
    response += f"To Account: {to_account_id}\n\n"
    response += f"**Transaction Details:**\n"
    response += f"• Withdrawal ID: {withdrawal_id}\n"
    response += f"• Deposit ID: {deposit_id}\n\n"
    response += f"*If you need to reverse this transfer, just ask me to reverse it!*"
    return response


def _fmt_deposit(data: dict) -> str:
    if not data.get("success", False):
        error = data.get("error", "Deposit failed")
        return f"❌ **Deposit Failed**\n\n{error}"
    amount = data.get("amount", 0)
    account = data.get("account", "N/A")
    transaction_id = data.get("transaction_id", "N/A")
    new_balance = data.get("new_balance")
    response = f"✅ **Deposit Successful**\n\n"
    response += f"Amount: **${amount:,.2f}**\n"
    response += f"Account: {account}\n"
    response += f"Transaction ID: {transaction_id}\n"
    if new_balance is not None:
        response += f"New Balance: **${new_balance:,.2f}**"
    return response


def _fmt_withdrawal(data: dict) -> str:
    if not data.get("success", False):
        error = data.get("error", "Withdrawal failed")
        return f"❌ **Withdrawal Failed**\n\n{error}"
    amount = data.get("amount", 0)
    account = data.get("account", "N/A")
    transaction_id = data.get("transaction_id", "N/A")
    new_balance = data.get("new_balance")
    response = f"✅ **Withdrawal Successful**\n\n"
    response += f"Amount: **${amount:,.2f}**\n"
    response += f"Account: {account}\n"
    response += f"Transaction ID: {transaction_id}\n"
    if new_balance is not None:
        response += f"New Balance: **${new_balance:,.2f}**"
    return response


class MCPTool(BaseTool):
    """
    LangChain tool wrapper for MCP server tools.
    """
    
    name: str
    description: str
    args_schema: Type[BaseModel] = MCPToolInput
    return_direct: bool = False
    
    # Custom fields for MCP integration
    tool_info: Optional[ToolInfo] = None
    mcp_client_manager: Optional[MCPClientManager] = None
    auth_manager: Optional[OAuthAuthenticationManager] = None
    _conversation_memory: Optional[Any] = PrivateAttr(default=None)  # Will be set by MCPToolProvider
    
    def __init__(self, 
                 tool_info: ToolInfo,
                 mcp_client_manager: MCPClientManager,
                 auth_manager: OAuthAuthenticationManager,
                 **kwargs):
        """
        Initialize MCP tool wrapper.
        
        Args:
            tool_info: Information about the MCP tool
            mcp_client_manager: MCP client manager for tool execution
            auth_manager: OAuth authentication manager
        """
        # Set tool name and description
        name = tool_info.full_name.replace(".", "_")  # LangChain tools need valid Python identifiers
        
        # Create more specific descriptions for banking tools if no description is provided
        if not tool_info.description:
            if tool_info.name == "create_transfer":
                description = "Transfer money between bank accounts. Requires from_account_id, to_account_id, and amount parameters."
            elif tool_info.name == "get_my_accounts":
                description = "Get a list of the user's bank accounts with account IDs and names."
            elif tool_info.name == "get_account_balance":
                description = "Get the current balance for a specific bank account. Requires account_id parameter."
            elif tool_info.name == "get_my_transactions":
                description = "Get transaction history for the user's accounts. Optional account_id parameter to filter by account."
            elif tool_info.name == "create_deposit":
                description = "Make a deposit to a bank account. Requires account_id and amount parameters."
            elif tool_info.name == "create_withdrawal":
                description = "Make a withdrawal from a bank account. Requires account_id and amount parameters."
            else:
                description = f"Execute {tool_info.name} tool on {tool_info.server_name} server"
        else:
            description = tool_info.description
        
        # Create dynamic input schema based on tool parameters
        dynamic_schema = create_tool_input_schema(tool_info)
        
        # Build metadata from tool annotations for annotation-aware agent behaviour
        user_facing = (tool_info.annotations or {}).get("userFacing", {})
        tool_metadata = {
            "destructive": bool(user_facing.get("destructive", False)),
            "idempotent": bool(user_facing.get("idempotent", True)),
            "readable": bool(user_facing.get("readable", True)),
        }

        # Initialize parent class properly
        super().__init__(
            name=name,
            description=description,
            args_schema=dynamic_schema,
            return_direct=False,
            metadata=tool_metadata,
            **kwargs
        )
        
        # Set custom attributes
        self.tool_info = tool_info
        self.mcp_client_manager = mcp_client_manager
        self.auth_manager = auth_manager

        logger.debug(f"Initialized MCP tool wrapper: {self.name}")
        logger.debug(f"Using schema: {dynamic_schema.__name__}")
        if hasattr(dynamic_schema, '__annotations__'):
            logger.debug(f"Schema fields: {list(dynamic_schema.__annotations__.keys())}")
    
    def _run(self, parameters: Dict[str, Any]) -> str:
        """Synchronous run method (not used, but required by BaseTool)."""
        raise NotImplementedError("MCPTool only supports async execution")
    
    async def _arun(self, **kwargs) -> str:
        """
        Execute the MCP tool asynchronously.
        
        Args:
            **kwargs: Keyword arguments from the dynamic schema
            
        Returns:
            str: Tool execution result as string
            
        Raises:
            RuntimeError: If session context is not set
            Exception: If tool execution fails
        """
        # Extract parameters from kwargs - if using dynamic schema, parameters are direct kwargs
        # If using generic schema, parameters are nested under 'parameters' key
        if 'parameters' in kwargs and isinstance(kwargs['parameters'], dict):
            # Generic schema case
            parameters = kwargs['parameters']
        else:
            # Dynamic schema case - all kwargs are parameters
            parameters = {k: v for k, v in kwargs.items() if v is not None}
        
        logger.debug(f"MCPTool._arun called with kwargs: {kwargs}")
        logger.debug(f"Extracted parameters: {parameters}")
        logger.debug(f"Tool info: {self.tool_info}")
        logger.debug(f"Current session ID: {_current_session_id_var.get()}")

        if not _current_session_id_var.get():
            logger.error("Session context not set for MCP tool execution")
            raise RuntimeError("Session context not set for MCP tool execution")
        
        try:
            # Get agent token with ai_agent scope
            # Always delegate to get_client_credentials_token — it has internal caching
            # with a 5-minute expiry buffer. Using is_expired() directly bypasses the buffer
            # and can pass a near-expired token that AIC rejects during introspection.
            _current_agent_token_var.set(await self.auth_manager.get_client_credentials_token(
                additional_scopes=["ai_agent"]
            ))
            # BL-01: never log the raw AccessToken — mask via fingerprint helper.
            # AccessToken.__repr__ also masks, but logging the fingerprint is the
            # form callers should imitate when debugging token flow.
            logger.debug(
                f"Agent token ready: {_current_agent_token_var.get().masked_fingerprint() if _current_agent_token_var.get() else 'none'}"
            )
            
            logger.info(f"Executing MCP tool {self.tool_info.full_name} with parameters: {parameters}")
            logger.debug(f"Tool execution details - Server: {self.tool_info.server_name}, Tool: {self.tool_info.name}, Session: {_current_session_id_var.get()}")

            # Log MCP tool execution start with detailed payload
            tracer = _current_tracer.get()
            if tracer:
                tracer.log_step("mcp_tool_request", f"MCP Server: {self.tool_info.server_name}", {
                    "tool_name": self.tool_info.name,
                    "server_name": self.tool_info.server_name,
                    "input_parameters": parameters,
                    "session_id": _current_session_id_var.get(),
                    "agent_token_present": bool(_current_agent_token_var.get()),
                    "tool_description": self.tool_info.description,
                    "request_timestamp": datetime.now().isoformat()
                })
            
            # Execute tool through MCP client manager
            start_time = datetime.now()
            result = await self.mcp_client_manager.execute_tool(
                server_name=self.tool_info.server_name,
                tool_name=self.tool_info.name,
                parameters=parameters,
                agent_token=_current_agent_token_var.get(),
                session_id=_current_session_id_var.get()
            )
            execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # WR-04: result bodies carry balances/PII — debug only.
            logger.debug(f"Raw MCP tool result: {result}")
            logger.debug(f"Result type: {type(result)}")
            logger.debug(f"Result keys: {list(result.keys()) if isinstance(result, dict) else 'Not a dict'}")
            # Presence flag for diagnostics/telemetry — checks the locations the
            # detection below understands (canonical _meta, defensive root).
            _has_auth_challenge = isinstance(result, dict) and (
                (isinstance(result.get("_meta"), dict) and "authChallenge" in result["_meta"])
                or "authChallenge" in result
            )
            logger.debug(f"Has authChallenge: {_has_auth_challenge}")

            # Log MCP tool execution response with detailed payload
            tracer = _current_tracer.get()
            if tracer:
                tracer.log_step("mcp_tool_response", f"MCP Server: {self.tool_info.server_name}", {
                    "tool_name": self.tool_info.name,
                    "server_name": self.tool_info.server_name,
                    "result": result,
                    "result_type": type(result).__name__,
                    "execution_time_ms": execution_time_ms,
                    "session_id": _current_session_id_var.get(),
                    "success": True,
                    "response_timestamp": datetime.now().isoformat(),
                    "has_auth_challenge": _has_auth_challenge
                })
            
            # Handle authentication challenges
            if isinstance(result, dict) and result.get("type") == "auth_challenge":
                logger.info("Authentication challenge detected in result")
                challenge = result.get("challenge")
                if isinstance(challenge, AuthChallenge):
                    logger.info(f"Handling auth challenge: {challenge}")
                    return await self._handle_auth_challenge(challenge, parameters)
                else:
                    logger.warning(f"Invalid challenge format: {challenge}")
            
            # Check if this is an authorization challenge response
            auth_challenge = None
            if isinstance(result, dict):
                # Canonical location: result._meta.authChallenge (MCP-spec extension slot).
                meta = result.get("_meta")
                if isinstance(meta, dict) and "authChallenge" in meta:
                    auth_challenge = meta.get("authChallenge", {})
                    logger.info("Found authChallenge in result._meta")
                # Tolerate a root-level authChallenge (defensive; not emitted by the server).
                elif "authChallenge" in result:
                    auth_challenge = result.get("authChallenge", {})
                    logger.info("Found authChallenge at root level")
            
            if auth_challenge:
                logger.info("Authorization challenge detected in MCP response")
                logger.debug(f"Auth challenge data: {auth_challenge}")
                
                # Store the challenge information for this session
                await self._store_auth_challenge(auth_challenge, parameters)
                
                # Check the authorization method
                auth_method = auth_challenge.get("method", "manual")
                auth_url = auth_challenge.get("authorizationUrl", "")
                scope = auth_challenge.get("scope", "")
                expires_at = auth_challenge.get("expiresAt", "")
                ui_hints = auth_challenge.get("uiHints", {})
                status_endpoint = auth_challenge.get("statusEndpoint", "")
                
                if auth_method == "redirect_popup":
                    # Format message for popup authorization
                    popup_width = ui_hints.get("popupWidth", 500)
                    popup_height = ui_hints.get("popupHeight", 650)
                    popup_title = ui_hints.get("popupTitle", "Authorization Required")
                    
                    # WR-05: injection-safe JSON via shared helper.
                    formatted_message = build_auth_popup_message(
                        auth_url=auth_url,
                        popup_width=popup_width,
                        popup_height=popup_height,
                        popup_title=popup_title,
                        status_endpoint=status_endpoint,
                        session_id=auth_challenge.get('sessionId', ''),
                        scope=scope,
                        expires_at=expires_at,
                    )
                    
                    logger.info("Returning popup authorization challenge message to user")
                    return formatted_message
                else:
                    # Fallback to manual authorization
                    formatted_message = f"""**Authorization Required**

To access your banking data, I need your permission. Please complete these steps:

**Step 1:** Click the link below to authorize access:
[**Click here to authorize**]({auth_url})

**Step 2:** Complete the login and authorization process in your browser

**Step 3:** Copy the authorization code from the response page

**Step 4:** Paste the authorization code back here

**Details:**
- Required permissions: `{scope}`
- Authorization expires: `{expires_at}`

Once you provide the authorization code, I'll automatically retrieve your account information."""
                    
                    logger.info("Returning manual authorization challenge message to user")
                    return formatted_message
            
            # Convert result to string for LangChain
            if isinstance(result, dict):
                logger.debug("Processing dictionary result")
                # Try to extract meaningful content
                if "result" in result:
                    content = result["result"]
                    logger.debug(f"Extracted 'result' field: {content}")
                elif "data" in result:
                    content = result["data"]
                    logger.debug(f"Extracted 'data' field: {content}")
                elif "message" in result:
                    content = result["message"]
                    logger.debug(f"Extracted 'message' field: {content}")
                elif "content" in result and isinstance(result["content"], list):
                    # Handle content array format
                    content_items = []
                    for item in result["content"]:
                        if isinstance(item, dict) and item.get("type") == "text":
                            content_items.append(item.get("text", ""))
                    content = "\n".join(content_items) if content_items else str(result)
                    logger.debug(f"Extracted content array: {content}")
                else:
                    content = str(result)
                    logger.debug(f"Using full result as string: {content}")
            else:
                content = str(result)
                logger.debug(f"Converting non-dict result to string: {content}")
            
            # Try to format JSON responses nicely for users
            formatted_content = self._format_json_response(content)
            if formatted_content != content:
                logger.debug(f"Formatted JSON response for better user experience")
                content = formatted_content
            
            logger.info(f"Successfully executed MCP tool {self.tool_info.full_name}")
            logger.debug(f"Final content to return: {content}")
            return content
            
        except Exception as e:
            logger.error(f"Error executing MCP tool {self.tool_info.full_name}: {e}")
            logger.error(f"Exception type: {type(e)}")
            logger.error(f"Exception args: {e.args}")
            logger.error(f"Full traceback: {traceback.format_exc()}")

            # Log MCP tool execution error with detailed information
            tracer = _current_tracer.get()
            if tracer:
                execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000) if 'start_time' in locals() else 0
                tracer.log_step("mcp_tool_error", f"MCP Server: {self.tool_info.server_name}", {
                    "tool_name": self.tool_info.name,
                    "server_name": self.tool_info.server_name,
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "error_args": str(e.args),
                    "execution_time_ms": execution_time_ms,
                    "session_id": _current_session_id_var.get(),
                    "success": False,
                    "traceback": traceback.format_exc()[:1000],  # Truncate long tracebacks
                    "error_timestamp": datetime.now().isoformat()
                })
            
            # Return error message that LangChain can work with
            error_msg = f"Tool execution failed: {str(e)}"
            if "authentication" in str(e).lower():
                error_msg += " (Authentication required - user may need to authorize access)"
            
            logger.debug(f"Returning error message: {error_msg}")
            return error_msg
    
    async def _handle_auth_challenge(self, challenge: AuthChallenge, original_parameters: Dict[str, Any]) -> str:
        """
        Handle authentication challenge from MCP server.
        
        Args:
            challenge: The authentication challenge
            original_parameters: Original tool parameters
            
        Returns:
            str: Message indicating authorization is needed
        """
        try:
            logger.info(f"Handling auth challenge for tool {self.tool_info.full_name}")
            
            # Generate authorization URL for user
            auth_url = self.auth_manager.generate_user_authorization_url(
                scope=challenge.scope,
                session_id=_current_session_id_var.get(),
                mcp_server_id=self.tool_info.server_name
            )
            
            # Return message to user with authorization URL
            return (f"This action requires user authorization. "
                   f"Please visit the following URL to authorize access: {auth_url}\n\n"
                   f"After authorization, please try your request again.")
            
        except Exception as e:
            logger.error(f"Error handling auth challenge: {e}")
            return f"Authentication required but failed to generate authorization URL: {str(e)}"
    
    async def _store_auth_challenge(self, auth_challenge: Dict[str, Any], original_parameters: Dict[str, Any]) -> None:
        """
        Store authentication challenge information for later use.
        
        Args:
            auth_challenge: The authentication challenge from MCP server
            original_parameters: The original tool parameters
        """
        logger.info(f"Storing auth challenge for session {_current_session_id_var.get()}")
        logger.debug(f"Auth challenge: {auth_challenge}")

        # Store challenge info in the tool provider (this could be enhanced to use a proper session store)
        if hasattr(self.mcp_client_manager, '_session_challenges'):
            self.mcp_client_manager._session_challenges[_current_session_id_var.get()] = {
                'tool_name': self.tool_info.name,
                'server_name': self.tool_info.server_name,
                'parameters': original_parameters,
                'auth_challenge': auth_challenge,
                'timestamp': datetime.now()
            }
        else:
            # Initialize the session challenges dict if it doesn't exist
            self.mcp_client_manager._session_challenges = {
                _current_session_id_var.get(): {
                    'tool_name': self.tool_info.name,
                    'server_name': self.tool_info.server_name,
                    'parameters': original_parameters,
                    'auth_challenge': auth_challenge,
                    'timestamp': datetime.now()
                }
            }

        logger.debug(f"Stored challenge for session {_current_session_id_var.get()}")

    def set_session_context(self, session_id: str, agent_token: Optional[AccessToken] = None) -> None:
        """
        Set session context for tool execution.
        
        Args:
            session_id: The current session ID
            agent_token: Optional agent token (will be obtained if not provided)
        """
        logger.debug(f"Setting session context for tool {self.name}")
        logger.debug(f"Previous session ID: {_current_session_id_var.get()}")
        logger.debug(f"New session ID: {session_id}")
        logger.debug(f"Previous agent token: {_current_agent_token_var.get().masked_fingerprint() if _current_agent_token_var.get() else 'none'}")
        logger.debug(f"New agent token: {agent_token.masked_fingerprint() if agent_token else 'none'}")

        _current_session_id_var.set(session_id)
        _current_agent_token_var.set(agent_token)

        logger.info(f"Set session context for tool {self.name}: session={session_id}, token_provided={agent_token is not None}")
        logger.debug(f"Tool {self.name} now has session_id={_current_session_id_var.get()}, token={_current_agent_token_var.get().masked_fingerprint() if _current_agent_token_var.get() else 'none'}")

    def _format_json_response(self, content: str) -> str:
        return format_tool_response(content, self.tool_info.name)
    


class MCPToolProvider:
    """
    Provider that exposes MCP server capabilities as LangChain tools.
    """
    
    def __init__(self, 
                 mcp_client_manager: MCPClientManager,
                 auth_manager: OAuthAuthenticationManager,
                 conversation_memory: Optional[Any] = None):
        """
        Initialize MCP tool provider.
        
        Args:
            mcp_client_manager: MCP client manager
            auth_manager: OAuth authentication manager
            conversation_memory: Optional conversation memory for storing context
        """
        self.mcp_client_manager = mcp_client_manager
        self.auth_manager = auth_manager
        self.conversation_memory = conversation_memory
        self._tools: List[MCPTool] = []
        self._current_session_id = None
        self._current_agent_token = None
        
        logger.info("Initialized MCP tool provider")
    
    def set_tracer(self, tracer):
        """Set the current tracer for MCP tool execution logging.

        WR-06: scoped to the calling async context (ContextVar), not a
        process-wide global. Called once per agent turn BEFORE tool execution
        in that turn — the value propagates (copy-on-create) into any child
        tasks the agent executor spawns, so concurrent sessions never see
        each other's tracer.
        """
        _current_tracer.set(tracer)
    
    async def get_langchain_tools(self) -> List[BaseTool]:
        """
        Get all available MCP tools as LangChain tools.
        
        Returns:
            List of LangChain BaseTool instances
        """
        try:
            # Get all available MCP tools
            available_tools = await self.mcp_client_manager.tool_registry.get_all_tools()
            
            # Create LangChain tool wrappers
            langchain_tools = []
            for tool_info in available_tools.values():
                mcp_tool = MCPTool(
                    tool_info=tool_info,
                    mcp_client_manager=self.mcp_client_manager,
                    auth_manager=self.auth_manager
                )
                mcp_tool._conversation_memory = self.conversation_memory
                langchain_tools.append(mcp_tool)
            
            self._tools = langchain_tools
            logger.info(f"Created {len(langchain_tools)} LangChain tools from MCP servers")
            
            return langchain_tools
            
        except Exception as e:
            logger.error(f"Error getting LangChain tools: {e}")
            return []
    
    async def get_tools_by_server(self, server_name: str) -> List[BaseTool]:
        """
        Get LangChain tools for a specific MCP server.
        
        Args:
            server_name: Name of the MCP server
            
        Returns:
            List of LangChain tools for the specified server
        """
        try:
            # Get tools for specific server
            server_tools = await self.mcp_client_manager.tool_registry.get_server_tools(server_name)
            
            # Create LangChain tool wrappers
            langchain_tools = []
            for tool_info in server_tools:
                mcp_tool = MCPTool(
                    tool_info=tool_info,
                    mcp_client_manager=self.mcp_client_manager,
                    auth_manager=self.auth_manager
                )
                mcp_tool._conversation_memory = self.conversation_memory
                langchain_tools.append(mcp_tool)
            
            logger.info(f"Created {len(langchain_tools)} LangChain tools for server {server_name}")
            return langchain_tools
            
        except Exception as e:
            logger.error(f"Error getting tools for server {server_name}: {e}")
            return []
    
    async def find_tools(self, pattern: str) -> List[BaseTool]:
        """
        Find LangChain tools matching a pattern.
        
        Args:
            pattern: Search pattern
            
        Returns:
            List of matching LangChain tools
        """
        try:
            # Find matching MCP tools
            matching_tools = await self.mcp_client_manager.tool_registry.find_tools(pattern)
            
            # Create LangChain tool wrappers
            langchain_tools = []
            for tool_info in matching_tools:
                mcp_tool = MCPTool(
                    tool_info=tool_info,
                    mcp_client_manager=self.mcp_client_manager,
                    auth_manager=self.auth_manager
                )
                mcp_tool._conversation_memory = self.conversation_memory
                langchain_tools.append(mcp_tool)
            
            logger.info(f"Found {len(langchain_tools)} LangChain tools matching pattern '{pattern}'")
            return langchain_tools
            
        except Exception as e:
            logger.error(f"Error finding tools with pattern '{pattern}': {e}")
            return []
    
    async def set_session_context(self, session_id: str) -> None:
        """
        Set session context for all tools.
        
        Args:
            session_id: The current session ID
        """
        logger.info(f"Setting session context for MCPToolProvider: {session_id}")
        logger.debug(f"Previous session ID: {self._current_session_id}")
        logger.debug(f"Number of tools to update: {len(self._tools)}")
        
        self._current_session_id = session_id
        
        # Get agent token for this session with ai_agent scope
        try:
            logger.debug("Requesting new agent token with ai_agent scope for session...")
            self._current_agent_token = await self.auth_manager.get_client_credentials_token(
                additional_scopes=["ai_agent"]
            )
            logger.info(f"Successfully obtained agent token with ai_agent scope for session {session_id}")
            logger.debug(f"Agent token details: {self._current_agent_token.masked_fingerprint() if self._current_agent_token else 'none'}")
        except Exception as e:
            logger.error(f"Failed to get agent token for session {session_id}: {e}")
            logger.error(f"Exception type: {type(e)}")
            logger.error(f"Full traceback: {traceback.format_exc()}")
            self._current_agent_token = None
        
        # Set context for all existing tools
        mcp_tools_updated = 0
        for i, tool in enumerate(self._tools):
            logger.debug(f"Processing tool {i}: {tool.name} (type: {type(tool)})")
            if isinstance(tool, MCPTool):
                logger.debug(f"Setting context for MCPTool: {tool.name}")
                tool.set_session_context(session_id, self._current_agent_token)
                mcp_tools_updated += 1
            else:
                logger.debug(f"Skipping non-MCPTool: {tool.name}")
        
        logger.info(f"Set session context for {mcp_tools_updated}/{len(self._tools)} MCP tools: {session_id}")
        logger.debug(f"Session context update complete - session_id={self._current_session_id}, token_available={self._current_agent_token is not None}")
    
    def _format_json_response_for_tool(self, content: str, tool_name: str) -> str:
        return format_tool_response(content, tool_name)

    async def refresh_tools(self) -> List[BaseTool]:
        """
        Refresh available tools from MCP servers.
        
        Returns:
            List of refreshed LangChain tools
        """
        try:
            logger.info("Refreshing MCP tools")
            
            # Get fresh tools
            new_tools = await self.get_langchain_tools()
            
            # Set session context for new tools if we have one
            if self._current_session_id:
                await self.set_session_context(self._current_session_id)
            
            logger.info(f"Refreshed tools, now have {len(new_tools)} available")
            return new_tools
            
        except Exception as e:
            logger.error(f"Error refreshing tools: {e}")
            return self._tools  # Return existing tools on error
    
    async def get_tool_info(self) -> List[Dict[str, Any]]:
        """
        Get information about all available tools.
        
        Returns:
            List of tool information dictionaries
        """
        tools_info = []
        
        for tool in self._tools:
            if isinstance(tool, MCPTool):
                tools_info.append({
                    "name": tool.name,
                    "description": tool.description,
                    "server_name": tool.tool_info.server_name,
                    "tool_name": tool.tool_info.name,
                    "full_name": tool.tool_info.full_name
                })
        
        return tools_info
    
    def get_current_session_id(self) -> Optional[str]:
        """Get the current session ID."""
        return self._current_session_id
    
    def get_tools_count(self) -> int:
        """Get the number of available tools."""
        return len(self._tools)
    
    async def retry_pending_tool_call(self, session_id: str, tracer=None) -> Optional[str]:
        """
        Retry a pending tool call after user authorization completion.
        
        Args:
            session_id: The session ID
            tracer: Optional execution tracer
            
        Returns:
            Optional[str]: Result of the retried tool call, or None if no pending challenge
        """
        logger.info(f"Retrying pending tool call for session {session_id}")
        
        # Check if we have a pending challenge for this session
        if not hasattr(self.mcp_client_manager, '_session_challenges'):
            logger.warning(f"No session challenges store found")
            if tracer:
                tracer.log_step("tool_retry_failed", "MCP Tool Provider", {
                    "reason": "No session challenges store found",
                    "session_id": session_id
                })
            return None
            
        if session_id not in self.mcp_client_manager._session_challenges:
            logger.warning(f"No pending challenge found for session {session_id}")
            if tracer:
                tracer.log_step("tool_retry_failed", "MCP Tool Provider", {
                    "reason": "No pending challenge found for session",
                    "session_id": session_id
                })
            return None
        
        challenge_info = self.mcp_client_manager._session_challenges[session_id]
        logger.info(f"Found pending challenge for {challenge_info['server_name']}.{challenge_info['tool_name']}")
        
        # Log retry attempt
        if tracer:
            tracer.log_step("tool_retry_start", f"MCP Server: {challenge_info['server_name']}", {
                "tool_name": challenge_info['tool_name'],
                "server_name": challenge_info['server_name'],
                "original_parameters": challenge_info['parameters'],
                "session_id": session_id,
                "retry_reason": "OAuth authorization completed",
                "agent_token_present": bool(self._current_agent_token)
            })
        
        try:
            # Fetch a fresh agent token (cached internally with an expiry
            # buffer) — self._current_agent_token may be stale/expired by now.
            agent_token = await self.auth_manager.get_client_credentials_token(
                additional_scopes=["ai_agent"]
            )
            # Retry the tool call without any authorization code
            # The MCP server should now have the user session and can fulfill the request
            start_time = datetime.now()
            result = await self.mcp_client_manager.execute_tool(
                server_name=challenge_info['server_name'],
                tool_name=challenge_info['tool_name'],
                parameters=challenge_info['parameters'],
                agent_token=agent_token,
                user_auth_code=None,  # No auth code needed - server has the session
                session_id=session_id
            )
            execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
            
            # Log retry success
            if tracer:
                tracer.log_step("tool_retry_response", f"MCP Server: {challenge_info['server_name']}", {
                    "tool_name": challenge_info['tool_name'],
                    "server_name": challenge_info['server_name'],
                    "result": result,
                    "result_type": type(result).__name__,
                    "execution_time_ms": execution_time_ms,
                    "session_id": session_id,
                    "success": True,
                    "retry_successful": True
                })
            
            # Clear the pending challenge
            del self.mcp_client_manager._session_challenges[session_id]
            
            logger.info(f"Successfully retried tool call after authorization")
            
            # Convert result to string format (same logic as _arun method)
            if isinstance(result, dict):
                if "content" in result and isinstance(result["content"], list):
                    content_items = []
                    for item in result["content"]:
                        if isinstance(item, dict) and item.get("type") == "text":
                            content_items.append(item.get("text", ""))
                    content = "\n".join(content_items) if content_items else str(result)
                else:
                    content = str(result)
            else:
                content = str(result)
            
            # Apply JSON formatting for better user experience
            formatted_content = self._format_json_response_for_tool(content, challenge_info['tool_name'])
            
            # Log formatted response
            if tracer:
                tracer.log_step("tool_retry_formatted", "Response Formatter", {
                    "tool_name": challenge_info['tool_name'],
                    "raw_content": content,
                    "formatted_content": formatted_content,
                    "formatting_applied": formatted_content != content
                })
            
            return formatted_content
                
        except Exception as e:
            logger.error(f"Error retrying tool call after authorization: {e}")
            
            # Log retry error
            if tracer:
                execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000) if 'start_time' in locals() else 0
                tracer.log_step("tool_retry_error", f"MCP Server: {challenge_info['server_name']}", {
                    "tool_name": challenge_info['tool_name'],
                    "server_name": challenge_info['server_name'],
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "execution_time_ms": execution_time_ms,
                    "session_id": session_id,
                    "success": False,
                    "retry_failed": True
                })
            
            # Clear the pending challenge even on error
            if session_id in self.mcp_client_manager._session_challenges:
                del self.mcp_client_manager._session_challenges[session_id]
            raise

    async def handle_authorization_code(self, session_id: str, auth_code: str) -> Optional[str]:
        """
        Handle an authorization code from the user and retry the pending tool call.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code from the user
            
        Returns:
            Optional[str]: Result of the retried tool call, or None if no pending challenge
        """
        logger.info(f"Handling authorization code for session {session_id}")
        
        # Check if we have a pending challenge for this session
        if not hasattr(self.mcp_client_manager, '_session_challenges'):
            logger.warning(f"No session challenges store found")
            return None
            
        if session_id not in self.mcp_client_manager._session_challenges:
            logger.warning(f"No pending challenge found for session {session_id}")
            return None
        
        challenge_info = self.mcp_client_manager._session_challenges[session_id]
        logger.info(f"Found pending challenge for {challenge_info['server_name']}.{challenge_info['tool_name']}")
        
        try:
            # Handle session-based authorization
            if auth_code.startswith('SESSION_SUCCESS:'):
                logger.info("Processing session-based authorization")
                session_id_from_auth = auth_code.replace('SESSION_SUCCESS:', '')
                
                # For session-based auth, we don't need to create an AuthorizationCode object
                # The MCP server will handle the session internally
                user_auth_code = None
                logger.info(f"Using session-based authorization for session: {session_id_from_auth}")
            else:
                # Create authorization code object for traditional OAuth flow
                from models.auth import AuthorizationCode
                user_auth_code = AuthorizationCode(
                    code=auth_code,
                    state=challenge_info['auth_challenge'].get('state', ''),
                    scope=challenge_info['auth_challenge'].get('scope', ''),
                    issued_at=datetime.now()
                )
            
            # Fetch a fresh agent token (cached internally with an expiry
            # buffer) — self._current_agent_token may be stale/expired by now.
            agent_token = await self.auth_manager.get_client_credentials_token(
                additional_scopes=["ai_agent"]
            )
            # Retry the tool call with the authorization code
            result = await self.mcp_client_manager.execute_tool(
                server_name=challenge_info['server_name'],
                tool_name=challenge_info['tool_name'],
                parameters=challenge_info['parameters'],
                agent_token=agent_token,
                user_auth_code=user_auth_code,
                session_id=session_id
            )
            
            # Clear the pending challenge
            del self.mcp_client_manager._session_challenges[session_id]
            
            logger.info(f"Successfully retried tool call with authorization code")
            
            # Convert result to string format
            if isinstance(result, dict):
                if "content" in result and isinstance(result["content"], list):
                    content_items = []
                    for item in result["content"]:
                        if isinstance(item, dict) and item.get("type") == "text":
                            content_items.append(item.get("text", ""))
                    return "\n".join(content_items) if content_items else str(result)
                else:
                    return str(result)
            else:
                return str(result)
                
        except Exception as e:
            logger.error(f"Error retrying tool call with authorization code: {e}")
            # Clear the pending challenge even on error
            if session_id in self.mcp_client_manager._session_challenges:
                del self.mcp_client_manager._session_challenges[session_id]
            raise