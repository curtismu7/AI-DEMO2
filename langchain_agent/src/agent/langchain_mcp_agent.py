"""
LangChain MCP Agent implementation.
"""
import asyncio
import logging
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, SystemMessage, trim_messages
from langchain_core.messages.utils import count_tokens_approximately
from langchain_core.tools import BaseTool
from langchain_core.language_models.chat_models import BaseChatModel
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.runnables import RunnableConfig
from .llm_factory import get_llm

from mcp.tool_registry import MCPClientManager
from authentication.oauth_manager import OAuthAuthenticationManager
from models.auth import AccessToken
from models.chat import ChatMessage, ChatSession
from config.settings import get_config
from .mcp_tool_provider import MCPToolProvider, build_auth_popup_message
from .conversation_memory import ConversationMemory
from .execution_tracer import AgentExecutionTracer, TracingMixin
from .tracing_callback import DetailedTracingCallbackHandler


logger = logging.getLogger(__name__)


def _content_to_text(content: Any) -> str:
    """Flatten message content to plain text.

    Providers differ: OpenAI-style models return content as a plain str,
    while Anthropic-style providers return a list of content blocks
    (e.g. [{"type": "text", "text": "..."}]). Both streamed chunks and the
    final AIMessage need a uniform str for capture/streaming.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "".join(parts)
    return ""


class LangChainMCPAgent(TracingMixin):
    """
    LangChain agent that integrates with MCP servers for tool execution.
    
    This agent processes user messages using LangChain's reasoning capabilities
    and executes actions through MCP servers with proper OAuth authentication.
    
    Now includes real-time execution tracing and visualization capabilities.
    """
    
    def __init__(self, 
                 mcp_client_manager: MCPClientManager,
                 auth_manager: OAuthAuthenticationManager,
                 config=None):
        """
        Initialize the LangChain MCP agent.
        
        Args:
            mcp_client_manager: Manager for MCP server connections and tool execution
            auth_manager: OAuth authentication manager for agent tokens
            config: Optional configuration object
        """
        self.config = config or get_config()
        self.mcp_client_manager = mcp_client_manager
        self.auth_manager = auth_manager
        
        # Initialize LangChain components
        self.llm = self._initialize_llm()
        # Wire configured limits through (LANGCHAIN_MAX_CONTEXT_TOKENS /
        # CONVERSATION_HISTORY_LIMIT) — a bare ConversationMemory() silently
        # dropped them and always ran with the hardcoded defaults.
        chat_cfg = getattr(self.config, "chat", None)
        self._max_context_tokens = getattr(chat_cfg, "max_context_tokens", 4096)
        self.conversation_memory = ConversationMemory(
            max_messages_per_session=getattr(chat_cfg, "conversation_history_limit", 100),
            max_context_tokens=self._max_context_tokens,
        )
        self.mcp_tool_provider = MCPToolProvider(mcp_client_manager, auth_manager, self.conversation_memory)

        # LangGraph compiled graph — initialized once in initialize_tools()
        self._graph = None
        self._tools: List[BaseTool] = []
        # ONE checkpointer for the agent's lifetime. Constructing a fresh
        # MemorySaver on every (re)build wiped every session's history each
        # time refresh_tools() ran.
        self._checkpointer = MemorySaver()
        # Serializes graph (re)builds: both process_message paths lazily call
        # initialize_tools() when _graph is None, and unlocked they could race
        # two concurrent graph builds.
        self._init_lock = asyncio.Lock()

        logger.info("Initialized LangChain MCP Agent")
    
    def _initialize_llm(self) -> Optional[BaseChatModel]:
        """Initialize the language model via the LLM factory. Returns None for provider=none."""
        lc = self.config.langchain
        provider = getattr(lc, "provider", "none")
        llm = get_llm(
            provider=provider,
            model=lc.model_name or None,
            api_key=getattr(lc, "anthropic_api_key", "lm-studio"),
            temperature=lc.temperature,
            max_tokens=lc.max_tokens,
            streaming=bool(getattr(lc, "stream_llm_tokens", True)),
            lmstudio_base_url=getattr(lc, "lmstudio_base_url", "http://localhost:1234/v1"),
            anthropic_base_url=getattr(lc, "anthropic_base_url", ""),
            llamacpp_base_url=getattr(lc, "llamacpp_base_url", "http://127.0.0.1:8080"),
            llamacpp_model=getattr(lc, "llamacpp_model", "qwen3-8b"),
            helix_base_url=getattr(lc, "helix_base_url", ""),
            helix_api_key=getattr(lc, "helix_api_key", ""),
            helix_environment_id=getattr(lc, "helix_environment_id", ""),
            helix_agent_id=getattr(lc, "helix_agent_id", ""),
            helix_prompt_field_id=getattr(lc, "helix_prompt_field_id", ""),
        )
        logger.info("Initialized LLM via factory: provider=%s", provider)
        return llm
    
    async def initialize_tools(self, force: bool = False) -> None:
        """Initialize MCP tools for the agent.

        Serialized by _init_lock so the unlocked lazy-init in both
        process_message paths (`if not self._graph: ...`) cannot race two
        concurrent graph builds. With force=False an already-built graph is
        left untouched; refresh_tools() passes force=True to rebuild against
        the current MCP tool set (history survives — the shared
        self._checkpointer is reused, never recreated).
        """
        async with self._init_lock:
            if self._graph is not None and not force:
                return
            if self.llm is None:
                # provider=none — skip LangGraph, heuristic-only mode
                logger.info("LLM is None (provider=none) — skipping LangGraph graph, heuristic-only mode")
                self._tools = []
                return
            try:
                # Get available MCP tools
                self._tools = await self.mcp_tool_provider.get_langchain_tools()

                if not self._tools:
                    logger.warning("No MCP tools available for agent, using tool-less LangGraph agent")
                    self._graph = create_react_agent(
                        model=self.llm,
                        tools=[],
                        pre_model_hook=self._pre_model_hook,
                        checkpointer=self._checkpointer
                    )
                    logger.info("Initialized tool-less LangGraph agent")
                    return

                # Build a single compiled LangGraph StateGraph — the shared
                # checkpointer stores conversation history keyed by
                # thread_id=session_id across turns.
                self._graph = create_react_agent(
                    model=self.llm,
                    tools=self._tools,
                    pre_model_hook=self._pre_model_hook,
                    checkpointer=self._checkpointer
                )

                logger.info(f"Initialized LangGraph agent with {len(self._tools)} MCP tools")

            except Exception as e:
                logger.error(f"Failed to initialize agent tools: {e}")
                raise

    def _pre_model_hook(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Bound what the LLM actually reads to the configured token budget.

        Runs before every model call inside the graph. Returning
        "llm_input_messages" overrides the model input ONLY — the
        checkpointed graph state is not rewritten, so full history stays
        available while the prompt stays within max_context_tokens.
        """
        trimmed = trim_messages(
            state["messages"],
            strategy="last",
            include_system=True,
            token_counter=count_tokens_approximately,
            max_tokens=self._max_context_tokens,
            start_on="human",
            allow_partial=False,
        )
        return {"llm_input_messages": trimmed}


    async def _build_system_message(self, session_id: str, vertical_flavor: str = None) -> str:
        """Build the system prompt string for the given session.

        Extracts tool descriptions and user-identification context, then returns
        a plain string (not a ChatPromptTemplate).  The caller injects this as a
        SystemMessage into the LangGraph ainvoke messages list on the first turn
        for the session — subsequent turns rely on MemorySaver's stored state.

        Args:
            session_id: The chat session ID.
            vertical_flavor: Optional vertical persona string injected by the BFF
                from manifest.agent.systemPromptFlavor. When present it replaces
                the default "helpful AI banking assistant" base persona so the
                agent speaks the active vertical's domain language.
        """
        # Build tool descriptions
        if self._tools:
            tool_descriptions = []
            for tool in self._tools:
                tool_desc = f"- {tool.name}: {tool.description}"
                if hasattr(tool, 'args_schema') and tool.args_schema:
                    try:
                        schema = tool.args_schema.schema()
                        if 'properties' in schema:
                            params = list(schema['properties'].keys())
                            if params:
                                tool_desc += f" (Parameters: {', '.join(params)})"
                    except Exception:
                        pass
                tool_descriptions.append(tool_desc)
            tools_info = "\n".join(tool_descriptions)
        else:
            tools_info = "None currently available"

        # User identification context
        user_identified = await self.conversation_memory.is_user_identified(session_id)
        identified_user = await self.conversation_memory.get_identified_user(session_id) if user_identified else None

        if user_identified and identified_user:
            user_context = f"""
CURRENT USER STATUS: ✅ USER IDENTIFIED
- User Email: {identified_user.get('user_email', 'Unknown')}
- User ID: {identified_user.get('user_id', 'Unknown')}
- Identified At: {identified_user.get('identification_timestamp', 'Unknown')}

You can now proceed with banking operations for this identified user. Do NOT ask for their email again."""
        else:
            user_context = """
CURRENT USER STATUS: ❌ USER NOT IDENTIFIED
- You MUST ask the user to identify themselves by providing their email address
- Use the banking_query_user_by_email tool to check if the user exists in the system
- If the user doesn't exist, offer to help them register a new account
- Only proceed with banking operations after the user is identified and has an account"""

        base_persona = vertical_flavor if vertical_flavor else "You are a helpful AI assistant that can perform actions through various MCP (Model Context Protocol) servers."

        return f"""{base_persona}

{user_context}

Account Registration Process:
When registering a new user, collect the following information conversationally:
1. Email address (already provided during lookup)
2. First name and last name
3. Phone number
4. Date of birth (YYYY-MM-DD format)
5. Complete address (street, city, state, zip code, country)

Then use the user_management_account_registration tool with all collected information.

You have access to tools that can interact with external systems and APIs. When a user asks you to do something that requires external actions, use the appropriate tools to help them.

Key guidelines:
1. ALWAYS start by asking for the user's email address if they haven't been identified yet
2. Use banking_query_user_by_email to verify user existence before any banking operations
3. If user doesn't exist, guide them through account registration
4. When collecting registration info, ask for one piece of information at a time in a friendly, conversational manner
5. Validate information format (especially email, phone, date of birth) before proceeding
6. When a user asks to transfer money, use the banking_create_transfer tool (only after user identification)
7. When a user asks to check account balances, use the banking_get_account_balance tool (only after user identification)
8. When a user asks to list accounts, use the banking_get_my_accounts tool (only after user identification)
9. When a user asks about transactions, use the banking_get_my_transactions tool (only after user identification)
10. IMPORTANT: Account IDs are critical for banking operations. When you retrieve accounts with banking_get_my_accounts, the response includes account IDs that you MUST use for other operations like transfers, balance checks, etc.
11. When users refer to accounts by type (e.g., "checking account", "savings account"), use the account ID from the most recent account listing
12. If you need to perform operations on specific accounts but don't have recent account information, first call banking_get_my_accounts to get current account IDs
13. TRANSFER REVERSALS: When a user asks to reverse or undo a transfer, look at the conversation history for the most recent transfer details. A reversal means transferring the same amount back from the destination account to the source account. For example, if the last transfer was $100 from Account A to Account B, the reversal would be $100 from Account B to Account A.
14. Pay close attention to the conversation history - recent transfers will show the exact account IDs and amounts that can be used for reversals
15. Explain what you're doing when using tools
16. Handle authentication challenges gracefully by informing the user when authorization is needed
17. Provide clear, helpful responses based on tool results
18. If a tool fails, explain the error and suggest alternatives when possible
19. Be conversational and friendly when collecting user information for registration
20. Before calling any tool where the tool's metadata marks it as destructive (such as create_withdrawal, create_transfer, freeze_account, or delete_customer), state clearly what you are about to do and what the effect will be, so the user understands the action before it executes.

Available tools:
{tools_info}

IMPORTANT: Always review the conversation history before asking for additional information. Recent transfers, account details, and other banking operations are recorded in the chat history and should be referenced when users ask for related actions like reversals or follow-up operations.

Remember to maintain conversation context and provide helpful, accurate responses. Always prioritize user identification before banking operations."""

    def _make_stream_config(
        self,
        session_id: str,
        stream_context: Optional[Dict[str, Any]],
        tracer_callback,
    ) -> RunnableConfig:
        """
        Build a RunnableConfig for graph invocation.

        Streaming is handled by the astream_events loop in process_message_with_tracing
        — not via callbacks — so this method only wires the DetailedTracingCallbackHandler.

        Args:
            session_id: The chat session ID (used as thread_id for MemorySaver).
            stream_context: Optional dict with websocket_handler; kept for API symmetry.
            tracer_callback: DetailedTracingCallbackHandler instance to wire into callbacks.

        Returns:
            RunnableConfig with configurable thread_id, callbacks, and recursion_limit.
        """
        return RunnableConfig(
            configurable={"thread_id": session_id},
            callbacks=[tracer_callback],
            recursion_limit=getattr(self.config.langchain, "max_iterations", 25),
        )
    
    def _is_authorization_complete_message(self, message: str) -> bool:
        """
        Detect if the user message indicates authorization completion.
        
        Args:
            message: The user message
            
        Returns:
            bool: True if this indicates authorization completion
        """
        # Check for session success messages from frontend
        if message.startswith('SESSION_SUCCESS:'):
            return True
            
        # Check for common authorization completion phrases
        auth_completion_phrases = [
            'authorization completed',
            'authorized successfully',
            'auth complete',
            'login complete',
            'signed in successfully'
        ]
        
        message_lower = message.lower()
        return any(phrase in message_lower for phrase in auth_completion_phrases)

    def _detect_authorization_code(self, message: str) -> Optional[str]:
        """
        Detect if the user message contains an authorization code.
        
        Args:
            message: The user message
            
        Returns:
            Optional[str]: The authorization code if detected, None otherwise
        """
        import re
        
        # Check for session-based authorization success
        if message.startswith('SESSION_SUCCESS:'):
            logger.info("Detected session-based authorization success")
            return message  # Return the full session success message
        
        # Require an explicit prefix. The previous heuristic — \b[A-Za-z0-9_-]{20,}\b
        # plus a whole-message fallback — fired on normal user messages like
        # "let-me-check-my-balance-please", silently steering them into the OAuth
        # callback path. An OAuth code is only well-defined when the user is
        # responding to a request_user_authorization step, so callers must
        # surface it with a clear "code=", "authorization=", or "auth=" prefix.
        prefixed_patterns = [
            r'\bcode[:\s=]+([A-Za-z0-9_-]+)\b',
            r'\bauthorization[:\s=]+([A-Za-z0-9_-]+)\b',
            r'\bauth[:\s=]+([A-Za-z0-9_-]+)\b',
        ]
        for pattern in prefixed_patterns:
            # IN-01: each pattern has exactly one capture group, so re.findall
            # returns a list[str]. A prefixed OAuth code is a single token —
            # the first match for the first matching prefix is the code. The
            # old `max(matches, key=len)` "longest wins" tie-break was dead
            # complexity (and silently wrong if a group ever became a tuple).
            match = re.search(pattern, message, re.IGNORECASE)
            if match:
                return match.group(1)
        return None
    
    def _looks_like_email(self, message: str) -> bool:
        """
        Check if a message looks like an email address.
        
        Args:
            message: The message to check
            
        Returns:
            bool: True if message looks like an email
        """
        message = message.strip()
        return "@" in message and "." in message and len(message.split()) == 1
    
    async def _handle_user_identification(self, email: str, session_id: str, tracer=None) -> str:
        """
        Handle user identification by email lookup.
        
        Args:
            email: The user's email address
            session_id: The chat session ID
            tracer: Optional execution tracer
            
        Returns:
            str: Response message
        """
        try:
            logger.info(f"Looking up user with email: {email}")
            
            # Store the user's email message
            user_msg = ChatMessage.create_user_message(session_id, email)
            await self.conversation_memory.add_message(session_id, user_msg)
            
            # Set session context for tools
            await self.mcp_tool_provider.set_session_context(session_id)
            
            # Set tracer for MCP tool execution if provided (do this before tool execution)
            if tracer:
                self.mcp_tool_provider.set_tracer(tracer)
            
            # Use user lookup tool. IN-02: resolve by name with an explicit
            # guard so a missing/renamed MCP tool fails loudly (logged with
            # the names that ARE registered) instead of silently falling
            # through to the opaque "having trouble" message.
            USER_LOOKUP_TOOL = "banking_query_user_by_email"
            lookup_tool = next(
                (
                    t
                    for t in self._tools
                    if getattr(t, "name", None) == USER_LOOKUP_TOOL
                ),
                None,
            )
            if lookup_tool is None:
                logger.warning(
                    "User-lookup tool %r not registered; available tools: %s. "
                    "Has the MCP server renamed it?",
                    USER_LOOKUP_TOOL,
                    [getattr(t, "name", "?") for t in self._tools],
                )
            for tool in ([lookup_tool] if lookup_tool is not None else []):
                if tool.name == USER_LOOKUP_TOOL:
                    logger.info("Found user lookup tool, executing...")
                    
                    # Log the tool execution start if tracer is available
                    if tracer:
                        tracer.log_step("direct_tool_execution", "User Identification", {
                            "tool_name": tool.name,
                            "reason": "Direct user identification via email",
                            "input_parameters": {"email": email},
                            "session_id": session_id,
                            "bypass_langchain_agent": True
                        })
                    
                    start_time = datetime.now()
                    result = await tool.arun({"email": email})
                    execution_time_ms = int((datetime.now() - start_time).total_seconds() * 1000)
                    
                    logger.info(f"User lookup result: {result}")
                    
                    # Log the tool execution result if tracer is available
                    if tracer:
                        tracer.log_step("direct_tool_result", "User Identification", {
                            "tool_name": tool.name,
                            "result": result,
                            "execution_time_ms": execution_time_ms,
                            "session_id": session_id,
                            "success": True
                        })
                    
                    # Parse the result. MCP tool results can come back as a
                    # str (possibly with prose around the JSON), an already
                    # decoded dict, or a list of content blocks — normalize
                    # before any membership checks. (`"exists" in result`
                    # raised TypeError on dict results and was swallowed by
                    # the broad outer except, hiding the real failure behind
                    # a generic "having trouble" message.)
                    import json
                    user_data = None
                    if isinstance(result, dict):
                        user_data = result
                    else:
                        result_text = (
                            _content_to_text(result)
                            if isinstance(result, list)
                            else str(result)
                        )
                        # Extract the JSON object from the result string
                        start_idx = result_text.find("{")
                        end_idx = result_text.rfind("}") + 1
                        if start_idx >= 0 and end_idx > start_idx:
                            try:
                                user_data = json.loads(result_text[start_idx:end_idx])
                            except json.JSONDecodeError as e:
                                logger.error(f"User lookup result JSON parse failed: {e}")
                                logger.error(f"Raw result: {result_text}")
                        else:
                            logger.error(
                                f"User lookup result contains no JSON object; raw result: {result_text}"
                            )

                    if isinstance(user_data, dict) and "exists" in user_data:
                        if user_data.get("exists", False):
                            # User exists, mark as identified
                            user_info = user_data.get("user", {})
                            user_id = user_info.get("id", "")
                            first_name = user_info.get("firstName", "")

                            await self.conversation_memory.set_user_identified(session_id, email, user_id)

                            response = f"✅ Welcome back, {first_name}! I've identified your account. How can I help you with your banking today?"

                            # Log response generation (template-based, not LLM)
                            if tracer:
                                tracer.log_step("template_response_generation", "Response Generator", {
                                    "response_type": "user_identification_success",
                                    "template_used": "welcome_back_template",
                                    "variables": {
                                        "first_name": first_name,
                                        "user_id": user_id,
                                        "email": email
                                    },
                                    "generated_response": response,
                                    "llm_used": False,
                                    "reason": "System template for user identification"
                                })

                            # Store the assistant's response
                            assistant_msg = ChatMessage.create_assistant_message(
                                session_id,
                                response,
                                {"user_identified": True, "user_email": email, "user_id": user_id}
                            )
                            await self.conversation_memory.add_message(session_id, assistant_msg)

                            return response
                        else:
                            # User doesn't exist, offer registration
                            # Store registration context in session
                            await self.conversation_memory.update_session_context(session_id, {
                                "registration_offered": True,
                                "registration_email": email,
                                "registration_step": "confirmation"
                            })

                            response = f"""I couldn't find an account with the email address: {email}

Would you like me to help you register a new banking account? I'll need to collect some information from you:
- Your full name
- Phone number
- Date of birth
- Address

Would you like to proceed with account registration? Just say "yes" or "register" to get started!"""

                            # Log response generation (template-based, not LLM)
                            if tracer:
                                tracer.log_step("template_response_generation", "Response Generator", {
                                    "response_type": "user_not_found_registration_offer",
                                    "template_used": "registration_offer_template",
                                    "variables": {
                                        "email": email
                                    },
                                    "generated_response": response,
                                    "llm_used": False,
                                    "reason": "System template for registration offer"
                                })

                            # Store the assistant's response
                            assistant_msg = ChatMessage.create_assistant_message(
                                session_id,
                                response,
                                {"registration_offered": True, "user_email": email}
                            )
                            await self.conversation_memory.add_message(session_id, assistant_msg)

                            return response
                    elif user_data is not None:
                        logger.error(
                            f"User lookup result has no 'exists' field; parsed: {user_data}"
                        )
                    # else: the parse failure was already logged distinctly
                    # above — fall through to the generic fallback response.

                    break
            
            # Fallback if tool not found or failed
            response = f"I'm having trouble looking up your account right now. Please try again or contact support."
            
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"lookup_failed": True}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response
            
        except Exception as e:
            logger.error(f"Error during user identification: {e}")
            response = f"I encountered an error while looking up your account. Please try again or contact support."
            
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"identification_error": True}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response

    def _looks_like_registration_confirmation(self, message: str) -> bool:
        """
        Check if a message looks like a registration confirmation.
        
        Args:
            message: The message to check
            
        Returns:
            bool: True if message looks like registration confirmation
        """
        message_lower = message.lower().strip()
        confirmation_phrases = [
            'yes', 'y', 'register', 'sure', 'ok', 'okay', 'proceed', 'continue'
        ]
        return message_lower in confirmation_phrases

    async def _handle_registration_flow(self, user_message: str, session_id: str) -> str:
        """
        Handle the registration flow for new users.
        
        Args:
            user_message: The user's message
            session_id: The session ID
            
        Returns:
            str: Response message
        """
        context = await self.conversation_memory.get_session_context(session_id)
        registration_step = context.get("registration_step", "")
        registration_email = context.get("registration_email", "")
        
        if registration_step == "confirmation" and self._looks_like_registration_confirmation(user_message):
            # User confirmed registration, start collecting info
            await self.conversation_memory.update_session_context(session_id, {
                "registration_step": "collecting_name",
                "registration_data": {"email": registration_email}
            })
            
            response = f"""Great! Let's get you registered. I'll collect your information step by step.

First, what's your full name? (Please provide your first and last name)"""
            
            # Store the assistant's response
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"registration_step": "collecting_name"}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response
        
        elif registration_step == "collecting_name":
            # User provided their name, store it and ask for phone
            registration_data = context.get("registration_data", {})
            registration_data["full_name"] = user_message.strip()
            
            await self.conversation_memory.update_session_context(session_id, {
                "registration_step": "collecting_phone",
                "registration_data": registration_data
            })
            
            response = f"""Thank you, {user_message.strip()}! 

Next, I need your phone number. Please provide your phone number (e.g., +1-555-123-4567):"""
            
            # Store the assistant's response
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"registration_step": "collecting_phone"}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response
        
        elif registration_step == "collecting_phone":
            # User provided phone, store it and ask for date of birth
            registration_data = context.get("registration_data", {})
            registration_data["phone"] = user_message.strip()
            
            await self.conversation_memory.update_session_context(session_id, {
                "registration_step": "collecting_dob",
                "registration_data": registration_data
            })
            
            response = """Great! Now I need your date of birth.

Please provide your date of birth in YYYY-MM-DD format (e.g., 1990-01-15):"""
            
            # Store the assistant's response
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"registration_step": "collecting_dob"}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response
        
        elif registration_step == "collecting_dob":
            # User provided date of birth, store it and ask for address
            registration_data = context.get("registration_data", {})
            registration_data["date_of_birth"] = user_message.strip()
            
            await self.conversation_memory.update_session_context(session_id, {
                "registration_step": "collecting_address",
                "registration_data": registration_data
            })
            
            response = """Perfect! Finally, I need your address information.

Please provide your complete address in this format:
Street Address, City, State, ZIP Code, Country

For example: 123 Main St, New York, NY, 10001, USA"""
            
            # Store the assistant's response
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response,
                {"registration_step": "collecting_address"}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            return response
        
        elif registration_step == "collecting_address":
            # User provided address. The actual user-registration MCP tool
            # is not wired up here yet (the original code path silently
            # faked success and stored a synthetic "new_user_<sid>" id).
            # Until the registration MCP tool is integrated, surface the
            # gap to the user instead of claiming a fake completion.
            registration_data = context.get("registration_data", {})
            registration_data["address"] = user_message.strip()

            await self.conversation_memory.update_session_context(session_id, {
                "registration_step": "pending_backend",
                "registration_data": registration_data,
            })

            response = (
                "Thanks — I have all the details:\n\n"
                f"Email: {registration_data.get('email', '')}\n"
                f"Name: {registration_data.get('full_name', '')}\n"
                f"Phone: {registration_data.get('phone', '')}\n"
                f"Date of Birth: {registration_data.get('date_of_birth', '')}\n"
                f"Address: {registration_data.get('address', '')}\n\n"
                "Registration backend isn't connected in this build, so I "
                "can't finalize a new account from chat. Please use the "
                "Setup page to provision a demo user, or sign in with an "
                "existing account."
            )

            # Do NOT call set_user_identified — nothing was actually
            # registered. Marking the user identified would mask later
            # tool calls failing because there is no real backend user.

            assistant_msg = ChatMessage.create_assistant_message(
                session_id,
                response,
                {"registration_completed": False, "registration_pending_backend": True},
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)

            return response
        
        # If we get here, registration flow didn't handle the message
        return None

    async def process_message_with_tracing(
        self,
        user_message: str,
        session_id: str,
        stream_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Process a user message with real-time execution tracing and visualization.
        
        Args:
            user_message: The user's input message
            session_id: The chat session ID
            stream_context: Optional dict with websocket_handler for stream_event (tool + LLM token) streaming
            
        Returns:
            str: The agent's response
        """
        # Create execution tracer
        tracer = self._create_tracer(session_id)
        
        try:
            # Log user input with detailed WebSocket message simulation
            self._log_websocket_message(tracer, "incoming", {
                "type": "user_message",
                "content": user_message,
                "session_id": str(session_id),  # Ensure session_id is string
                "timestamp": datetime.now().isoformat()
            })
            self._log_user_input(tracer, user_message, session_id)
            
            # Log agent start
            self._log_agent_start(tracer)
            
            if not self._graph:
                await self.initialize_tools()
                if not self._graph:
                    if self.llm is None:
                        return (
                            "No LLM is configured (LANGCHAIN_LLM_PROVIDER=none). "
                            "To enable AI responses, set LANGCHAIN_LLM_PROVIDER to "
                            "\"llamacpp\", \"anthropic\", \"lmstudio\", or \"anthropic-lmstudio\" "
                            "in langchain_agent/.env."
                        )
                    tracer.log_step("initialization_error", "LangChain Agent", {
                        "error": "Agent not properly configured with tools"
                    })
                    html_file = tracer.save_trace_and_create_visualization()
                    logger.info(f"Error trace saved: {html_file}")
                    return "I'm sorry, but I'm not properly configured with tools right now. Please try again later."
            
            logger.info(f"Processing message for session {session_id}: {user_message[:100]}...")
            
            # Check if this message indicates authorization completion
            if self._is_authorization_complete_message(user_message):
                tracer.log_step("oauth_completion", "OAuth Manager", {
                    "message_type": "authorization_complete"
                })
                
                logger.info("User has completed authorization, retrying original tool call...")
                
                try:
                    result = await self.mcp_tool_provider.retry_pending_tool_call(session_id, tracer)
                    if result:
                        tracer.log_step("tool_retry_success", "MCP Tool Provider", {
                            "result_length": len(str(result))
                        })
                        
                        # Log that no LLM formatting is used for retry responses
                        tracer.log_step("direct_response_return", "Response Handler", {
                            "response_type": "tool_retry_result",
                            "response": result,
                            "llm_formatting": False,
                            "reason": "Tool retry results are pre-formatted by MCP tool provider",
                            "bypass_agent_processing": True
                        })
                        
                        # Store conversation in memory
                        user_msg = ChatMessage.create_user_message(session_id, user_message)
                        await self.conversation_memory.add_message(session_id, user_msg)
                        
                        assistant_msg = ChatMessage.create_assistant_message(
                            session_id, 
                            result, 
                            {"auth_completed": True}
                        )
                        await self.conversation_memory.add_message(session_id, assistant_msg)
                        
                        self._log_response_sent(tracer, result, session_id)
                        html_file = tracer.save_trace_and_create_visualization()
                        logger.info(f"OAuth completion trace saved: {html_file}")
                        
                        return result
                    else:
                        tracer.log_step("tool_retry_failed", "MCP Tool Provider", {
                            "reason": "No pending tool call found"
                        })
                        logger.warning("No pending tool call found for this session")
                except Exception as e:
                    self._log_error(tracer, "MCP Tool Provider", e)
                    logger.error(f"Error retrying tool call after authorization: {e}")
                    html_file = tracer.save_trace_and_create_visualization()
                    logger.info(f"OAuth error trace saved: {html_file}")
                    return f"I encountered an error processing your request after authorization: {str(e)}. Please try your original request again."
            
            # Check if we're in a registration flow
            context = await self.conversation_memory.get_session_context(session_id)
            if context.get("registration_offered", False):
                tracer.log_step("registration_flow", "LangChain Agent", {
                    "registration_step": context.get("registration_step", "unknown"),
                    "registration_offered": True
                })
                
                logger.info("User is in registration flow, checking for registration response")
                registration_response = await self._handle_registration_flow(user_message, session_id)
                if registration_response:
                    user_msg = ChatMessage.create_user_message(session_id, user_message)
                    await self.conversation_memory.add_message(session_id, user_msg)
                    
                    self._log_response_sent(tracer, registration_response, session_id)
                    html_file = tracer.save_trace_and_create_visualization()
                    logger.info(f"Registration flow trace saved: {html_file}")
                    
                    return registration_response
            
            # Check if user is identified for this session
            is_user_identified = await self.conversation_memory.is_user_identified(session_id)
            self._log_memory_check(tracer, is_user_identified)
            
            logger.info(f"User identification status for session {session_id}: {is_user_identified}")
            
            # If user is not identified and this is not an email address, ask for identification
            if not is_user_identified and not self._looks_like_email(user_message):
                tracer.log_step("identification_request", "LangChain Agent", {
                    "reason": "User not identified and message is not email"
                })
                
                logger.info("User not identified, requesting email address")
                
                user_msg = ChatMessage.create_user_message(session_id, user_message)
                await self.conversation_memory.add_message(session_id, user_msg)
                
                identification_response = """Hello! I'm your AI banking assistant. To help you with your banking needs, I need to identify you first.

Please provide your email address so I can:
- Check if you have an existing account
- Help you register a new account if needed
- Provide personalized banking services

What's your email address?"""
                
                assistant_msg = ChatMessage.create_assistant_message(
                    session_id, 
                    identification_response,
                    {"identification_requested": True}
                )
                await self.conversation_memory.add_message(session_id, assistant_msg)
                
                self._log_response_sent(tracer, identification_response, session_id)
                html_file = tracer.save_trace_and_create_visualization()
                logger.info(f"Identification request trace saved: {html_file}")
                
                return identification_response
            
            # If user is not identified but message looks like an email, try to identify them
            if not is_user_identified and self._looks_like_email(user_message):
                tracer.log_step("email_detection", "LangChain Agent", {
                    "detected_email": user_message.strip(),
                    "action": "user_identification_attempt"
                })
                
                logger.info("Attempting to identify user with provided email")
                response = await self._handle_user_identification(user_message.strip(), session_id, tracer)
                
                self._log_response_sent(tracer, response, session_id)
                html_file = tracer.save_trace_and_create_visualization()
                logger.info(f"User identification trace saved: {html_file}")
                
                return response
            
            # Main agent processing via LangGraph graph
            logger.debug(f"Graph type: {type(self._graph)}")
            logger.debug(f"Number of available tools: {len(self._tools)}")

            # Set session context for tools and tracer
            tracer.log_step("mcp_context_setup", "MCP Tool Provider", {
                "session_id": session_id,
                "action": "set_session_context"
            })

            logger.info(f"Setting session context for tools...")
            await self.mcp_tool_provider.set_session_context(session_id)

            # Set tracer for MCP tool execution logging
            self.mcp_tool_provider.set_tracer(tracer)

            # Build messages list — inject SystemMessage only on the first turn
            # (when MemorySaver has no history for this thread_id) to avoid
            # accumulating duplicate system messages across turns.
            try:
                graph_state = self._graph.get_state({"configurable": {"thread_id": session_id}})
                has_prior_history = bool(graph_state.values.get("messages"))
            except Exception:
                has_prior_history = False

            if has_prior_history:
                msgs_for_graph = [HumanMessage(content=user_message)]
            else:
                system_msg_text = await self._build_system_message(session_id)
                msgs_for_graph = [SystemMessage(content=system_msg_text), HumanMessage(content=user_message)]

            detailed_callback = DetailedTracingCallbackHandler(tracer)
            config = self._make_stream_config(session_id, stream_context, detailed_callback)
            agent_input = {"messages": msgs_for_graph}

            prompt_text = f"User: {user_message}"
            estimated_input_tokens = len(prompt_text.split()) * 1.3
            self._log_llm_start(tracer, "Processing user request with LangGraph", prompt_text, int(estimated_input_tokens))

            ws_handler = stream_context.get("websocket_handler") if stream_context else None
            stream_tools = ws_handler and getattr(self.config.langchain, "stream_mcp_tool_events", True)
            stream_tokens = ws_handler and getattr(self.config.langchain, "stream_llm_tokens", True)

            logger.info("Executing LangGraph agent via astream_events...")
            start_time = datetime.now()
            last_response = ""

            async for event in self._graph.astream_events(agent_input, config=config, version="v2"):
                event_name = event.get("event")
                event_data = event.get("data") or {}

                if event_name == "on_tool_start" and stream_tools:
                    await ws_handler.send_message_to_session(session_id, {
                        "type": "stream_event",
                        "session_id": session_id,
                        "event": "tool_start",
                        "tool": event.get("name", "unknown_tool"),
                        "input": event_data.get("input"),
                    })

                elif event_name == "on_tool_end" and stream_tools:
                    output = event_data.get("output", "")
                    output_str = str(output) if not isinstance(output, str) else output
                    preview = output_str[:400] + "..." if len(output_str) > 400 else output_str
                    await ws_handler.send_message_to_session(session_id, {
                        "type": "stream_event",
                        "session_id": session_id,
                        "event": "tool_end",
                        "output_preview": preview,
                    })

                elif event_name == "on_chat_model_stream" and stream_tokens:
                    chunk = event_data.get("chunk")
                    # Anthropic-style providers stream list-of-blocks content;
                    # flatten so the client always receives a plain string.
                    token = _content_to_text(getattr(chunk, "content", "")) if chunk is not None else ""
                    if token:
                        await ws_handler.send_message_to_session(session_id, {
                            "type": "stream_event",
                            "session_id": session_id,
                            "event": "llm_token",
                            "token": token,
                        })

                elif event_name == "on_chain_end":
                    output = event_data.get("output")
                    if isinstance(output, dict) and "messages" in output:
                        msgs = output.get("messages", [])
                        if msgs:
                            last_msg = msgs[-1]
                            if getattr(last_msg, "type", None) == "ai":
                                # Content may be a str OR a list of content
                                # blocks (Anthropic-style) — flatten both.
                                content = _content_to_text(getattr(last_msg, "content", ""))
                                if content:
                                    last_response = content

            processing_time = int((datetime.now() - start_time).total_seconds() * 1000)
            response = last_response or "I'm sorry, I couldn't process your request."
            estimated_output_tokens = len(response.split()) * 1.3
            self._log_llm_end(tracer, response, processing_time, int(estimated_output_tokens))
            
            logger.info(f"Agent response length: {len(response)} characters")
            
            # Check for pending authorization challenges
            if hasattr(self.mcp_tool_provider.mcp_client_manager, '_session_challenges'):
                session_challenges = self.mcp_tool_provider.mcp_client_manager._session_challenges
                if session_id in session_challenges:
                    challenge_info = session_challenges[session_id]
                    auth_challenge = challenge_info.get('auth_challenge', {})
                    
                    if auth_challenge.get('method') == 'redirect_popup':
                        tracer.log_step("oauth_challenge", "OAuth Manager", {
                            "method": "redirect_popup",
                            "auth_url": auth_challenge.get('authorizationUrl', ''),
                            "popup_width": auth_challenge.get('uiHints', {}).get('popupWidth', 500),
                            "popup_height": auth_challenge.get('uiHints', {}).get('popupHeight', 650)
                        })
                        
                        logger.info("Intercepting response to inject popup authorization UI")
                        
                        # Create the popup authorization response
                        auth_url = auth_challenge.get('authorizationUrl', '')
                        ui_hints = auth_challenge.get('uiHints', {})
                        popup_width = ui_hints.get('popupWidth', 500)
                        popup_height = ui_hints.get('popupHeight', 650)
                        popup_title = ui_hints.get('popupTitle', 'Authorization Required')
                        status_endpoint = auth_challenge.get('statusEndpoint', '')
                        scope = auth_challenge.get('scope', '')
                        expires_at = auth_challenge.get('expiresAt', '')
                        session_id_auth = auth_challenge.get('sessionId', '')
                        
                        # WR-05: injection-safe JSON via shared helper.
                        popup_response = build_auth_popup_message(
                            auth_url=auth_url,
                            popup_width=popup_width,
                            popup_height=popup_height,
                            popup_title=popup_title,
                            status_endpoint=status_endpoint,
                            session_id=session_id_auth,
                            scope=scope,
                            expires_at=expires_at,
                        )

                        response = popup_response
            
            # Store conversation in memory
            self._log_memory_update(tracer, "store_conversation", {
                "user_message_length": len(user_message),
                "assistant_response_length": len(response)
            })
            
            user_msg = ChatMessage.create_user_message(session_id, user_message)
            await self.conversation_memory.add_message(session_id, user_msg)
            
            assistant_msg = ChatMessage.create_assistant_message(
                session_id, 
                response, 
                {"tools_used": [tool.name for tool in self._tools]}
            )
            await self.conversation_memory.add_message(session_id, assistant_msg)
            
            # Log final response with WebSocket message
            self._log_websocket_message(tracer, "outgoing", {
                "type": "assistant_response",
                "content": response,
                "session_id": str(session_id),  # Ensure session_id is string
                "timestamp": datetime.now().isoformat(),
                "processing_time_ms": int((datetime.now() - tracer.start_time).total_seconds() * 1000)
            })
            self._log_response_sent(tracer, response, session_id)
            
            # Save trace and create visualization
            html_file = tracer.save_trace_and_create_visualization()
            logger.info(f"Complete execution trace saved: {html_file}")
            
            logger.info(f"Successfully processed message for session {session_id}")
            return response
            
        except Exception as e:
            self._log_error(tracer, "LangChain Agent", e)
            logger.error(f"Error processing message for session {session_id}: {e}")
            
            # Save error trace
            html_file = tracer.save_trace_and_create_visualization()
            logger.info(f"Error trace saved: {html_file}")
            
            # Try to provide a helpful error response
            if "authentication" in str(e).lower() or "authorization" in str(e).lower():
                return "I encountered an authentication issue while trying to help you. Some actions may require additional authorization. Please try again or contact support if the issue persists."
            elif "timeout" in str(e).lower():
                return "I'm sorry, but your request took too long to process. Please try again with a simpler request."
            else:
                return "I encountered an error while processing your request. Please try again or rephrase your question."

    async def process_message(self, user_message: str, session_id: str) -> str:
        """
        Process a user message and return the agent's response.

        Thin delegate to process_message_with_tracing — the single
        implementation of the message pipeline (auth-completion retry,
        registration flow, user identification, LangGraph execution,
        auth-popup injection). This used to be a drifted ~200-line
        near-duplicate of that pipeline. Called without a stream_context, so
        no tool/LLM-token events are streamed.

        Args:
            user_message: The user's input message
            session_id: The chat session ID

        Returns:
            str: The agent's response
        """
        return await self.process_message_with_tracing(user_message, session_id)

    async def execute_tool(self, tool_name: str, parameters: Dict[str, Any], session_id: str) -> Dict[str, Any]:
        """
        Execute a specific tool directly.
        
        Args:
            tool_name: Name of the tool to execute
            parameters: Parameters for the tool
            session_id: The chat session ID
            
        Returns:
            Dict containing the tool execution result
            
        Raises:
            ValueError: If tool is not found
            Exception: If tool execution fails
        """
        # Find the tool
        tool = None
        for t in self._tools:
            if t.name == tool_name:
                tool = t
                break
        
        if not tool:
            raise ValueError(f"Tool '{tool_name}' not found")
        
        try:
            logger.info(f"Executing tool {tool_name} for session {session_id}")
            
            # Set session context
            await self.mcp_tool_provider.set_session_context(session_id)
            
            # Execute tool
            result = await tool.arun(parameters)
            
            logger.info(f"Successfully executed tool {tool_name}")
            return {"result": result, "tool_name": tool_name, "parameters": parameters}
            
        except Exception as e:
            logger.error(f"Error executing tool {tool_name}: {e}")
            raise
    
    async def get_available_tools(self) -> List[Dict[str, Any]]:
        """
        Get information about available tools.
        
        Returns:
            List of tool information dictionaries
        """
        if not self._tools:
            await self.initialize_tools()
        
        tools_info = []
        for tool in self._tools:
            tools_info.append({
                "name": tool.name,
                "description": tool.description,
                "parameters": getattr(tool, "args_schema", None)
            })
        
        return tools_info
    
    async def refresh_tools(self) -> None:
        """Refresh available tools from MCP servers."""
        try:
            logger.info("Refreshing MCP tools")

            # Reinitialize tools (force=True rebuilds the graph; the shared
            # checkpointer is reused so session history is preserved)
            await self.initialize_tools(force=True)

            logger.info(f"Refreshed tools, now have {len(self._tools)} available")
            
        except Exception as e:
            logger.error(f"Error refreshing tools: {e}")
            raise
    
    async def get_agent_status(self) -> Dict[str, Any]:
        """
        Get status information about the agent.
        
        Returns:
            Dict containing agent status information
        """
        return {
            "initialized": self._graph is not None,
            "tools_count": len(self._tools),
            "tools": [tool.name for tool in self._tools],
            "llm_model": getattr(self.llm, "model_name", "unknown"),
            "memory_sessions": await self.conversation_memory.get_active_sessions_count(),
            "mcp_manager_status": await self.mcp_client_manager.get_manager_status()
        }
    
    async def initialize_session_with_token(self, session_id: str, user_token: str) -> None:
        """
        Pre-identify a user STRICTLY from a validated, PingOne-issued access
        token delivered by the BFF proxy in `session_init` (Path A, CR-02/CR-04).

        Identity (`sub`, email claim) comes ONLY from the cryptographically
        validated token. There is no `/api/users/me` lookup and no fallback to
        a client-supplied id/email. A missing / invalid / expired / wrong-aud
        token is a hard refusal — the caller (message_processor) closes the
        session with an error.

        Args:
            session_id: The chat session ID
            user_token: PingOne access token resolved server-side by the BFF
                        proxy (never supplied by the browser).

        Raises:
            TokenValidationError: token absent / invalid / expired / wrong aud.
        """
        # Imported lazily so the agent module has no hard dependency on PyJWT
        # for code paths that never touch token validation.
        from authentication.token_validator import (
            get_token_validator,
            TokenValidationError,
        )

        if not user_token:
            raise TokenValidationError(
                "session_init carried no auth token — refusing session (Path A)"
            )

        identity = get_token_validator().validate(user_token)

        if not identity.email:
            # Identity must be usable for the banking flow. PingOne profile
            # without an email claim cannot be bound; refuse rather than guess.
            raise TokenValidationError(
                f"Validated token for sub={identity.sub} has no email claim — "
                f"cannot bind chat identity"
            )

        await self.conversation_memory.set_user_identified(
            session_id,
            user_email=identity.email,
            user_id=identity.sub,
        )
        logger.info(
            "Bound session %s to validated identity sub=%s (token-derived, Path A)",
            session_id,
            identity.sub,
        )

    async def clear_session_memory(self, session_id: str) -> None:
        """
        Clear conversation memory for a specific session.
        
        Args:
            session_id: The session ID to clear
        """
        await self.conversation_memory.clear_session(session_id)
        # Also drop the LangGraph checkpoint for this thread — otherwise the
        # graph keeps replaying the "cleared" conversation on the next turn.
        try:
            self._checkpointer.delete_thread(session_id)
        except Exception as e:
            logger.warning(f"Failed to delete checkpointer thread for session {session_id}: {e}")
        logger.info(f"Cleared memory for session {session_id}")
    
    async def shutdown(self) -> None:
        """Shutdown the agent and clean up resources."""
        try:
            await self.conversation_memory.cleanup()
            await self.mcp_client_manager.shutdown()
            logger.info("LangChain MCP Agent shutdown complete")
        except Exception as e:
            logger.error(f"Error during agent shutdown: {e}")