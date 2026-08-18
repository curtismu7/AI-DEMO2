"""
Helix LangChain chat model adapter.

Wraps the Helix conversation API in a LangChain BaseChatModel so it can be
passed directly to create_react_agent() and used anywhere LangChain expects
a chat model.

API flow (mirrors demo_api_server/services/helixLlmService.js):
  1. POST /environments/{env_id}/agents/{agent_id}/conversations
         body: {"agent": {"version": "published"}}
  2. POST /environments/{env_id}/conversations/{conv_id}/channels/{channel_id}/messages
         body: {"class": "start", "content": {prompt_field_id: prompt}}
         Content-Type: application/json; async=false
  3. Poll GET same messages URL until agent reply found (30 s timeout).

Auth: x-api-key header (NOT Authorization: Bearer).

System message handling: Helix directive fields are not always active in
published agents.  The system message is prepended to the user text so the
LLM receives full instruction context, matching helixLlmService.js behaviour.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, List, Optional, Sequence
from urllib.parse import urlparse
from uuid import uuid4

import httpx
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.utils.function_calling import convert_to_openai_tool
from pydantic import Field

logger = logging.getLogger(__name__)

HELIX_PATH = "/dpc/jas/helix/v1"
POLL_TIMEOUT_SECONDS = 30
POLL_INTERVAL_SECONDS = 1


def _api_base(base_url: str) -> str:
    """Return the canonical Helix API root from an arbitrary base URL."""
    try:
        origin = urlparse(base_url).scheme + "://" + urlparse(base_url).netloc
        return origin + HELIX_PATH
    except Exception:
        return base_url.rstrip("/").split("/dpc/")[0] + HELIX_PATH


def _extract_value(data: Any) -> Optional[str]:
    """
    Extract the agent response text from a Helix messages payload.
    Mirrors extractValue() in helixLlmService.js.
    """
    items = data if isinstance(data, list) else (data.get("content", [data]) if isinstance(data, dict) else [data])
    # Find completed message
    for m in items:
        if not isinstance(m, dict):
            continue
        if m.get("class") in ("complete",) or m.get("message_class") == "complete":
            raw = m.get("value")
            if raw is not None:
                if isinstance(raw, str):
                    try:
                        import json
                        parsed = json.loads(raw)
                        if isinstance(parsed, dict) and isinstance(parsed.get("response"), str):
                            return parsed["response"]
                    except Exception:
                        pass
                    return raw
    return None


def _msg_content(msg: BaseMessage) -> str:
    """Return a message's content as a plain string."""
    return msg.content if isinstance(msg.content, str) else str(msg.content)


def _render_tools_section(tools: Sequence[dict]) -> str:
    """
    Render the TOOLS prompt section for prompt-mediated tool calling.

    Helix has no native tool-call API, so tools are described in the prompt and
    the model is instructed to reply with a JSON tool_call envelope.
    """
    lines = ["TOOLS", "You have access to the following tools:", ""]
    for tool in tools:
        fn = tool.get("function", tool) if isinstance(tool, dict) else tool
        name = fn.get("name", "")
        description = fn.get("description", "")
        parameters = json.dumps(fn.get("parameters", {}))
        lines.append(f"- {name}: {description}")
        lines.append(f"  Parameters (JSON Schema): {parameters}")
    lines.extend([
        "",
        "To call a tool, reply with ONLY a JSON object in this exact format and nothing else:",
        '{"tool_call": {"name": "<tool name>", "arguments": { ... }}}',
        "If no tool is needed, reply in plain prose.",
    ])
    return "\n".join(lines)


def _render_transcript(messages: List[BaseMessage]) -> str:
    """Render conversation history (human/AI/tool messages) as a transcript."""
    lines: List[str] = []
    for msg in messages:
        if isinstance(msg, HumanMessage):
            lines.append(f"User: {_msg_content(msg)}")
        elif isinstance(msg, AIMessage):
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    envelope = {"tool_call": {"name": tc["name"], "arguments": tc["args"]}}
                    lines.append(f"Assistant: {json.dumps(envelope)}")
            else:
                lines.append(f"Assistant: {_msg_content(msg)}")
        elif isinstance(msg, ToolMessage):
            label = getattr(msg, "name", None) or msg.tool_call_id
            lines.append(f"Tool result ({label}): {_msg_content(msg)}")
    return "\n".join(lines)


def _build_prompt(messages: List[BaseMessage], tools: Optional[Sequence[dict]] = None) -> str:
    """
    Collapse a LangChain message list into the single prompt string that Helix
    receives via the prompt_field_id content key.

    Without tools or conversation history (no AI/tool messages), the system
    message is prepended to the last user message so instruction context is
    always present (matches helixLlmService.js behaviour).

    With tools bound and/or history present, the prompt becomes: system text,
    a TOOLS section (when tools are bound), the conversation transcript, and a
    closing instruction.
    """
    has_history = any(isinstance(m, (AIMessage, ToolMessage)) for m in messages)

    if not tools and not has_history:
        # Legacy single-turn format — unchanged tool-less behaviour.
        system_text = ""
        user_text = ""
        for msg in messages:
            content = _msg_content(msg)
            if isinstance(msg, SystemMessage):
                system_text = content
            elif isinstance(msg, HumanMessage):
                user_text = content  # last one wins

        if not user_text:
            # Fall back to last message of any type
            last = messages[-1] if messages else None
            user_text = _msg_content(last) if last else ""

        return f"{system_text}\n\n{user_text}" if system_text else user_text

    system_text = ""
    for msg in messages:
        if isinstance(msg, SystemMessage):
            system_text = _msg_content(msg)

    parts: List[str] = []
    if system_text:
        parts.append(system_text)
    if tools:
        parts.append(_render_tools_section(tools))
    parts.append(f"Conversation so far:\n{_render_transcript(messages)}")
    parts.append("Respond now as the Assistant.")
    return "\n\n".join(parts)


def _parse_reply(reply: str) -> AIMessage:
    """
    Parse a Helix text reply into an AIMessage, extracting a prompt-mediated
    tool call when the reply is a {"tool_call": {...}} JSON envelope.

    Malformed or absent tool calls fall back to a plain content message —
    this never raises on parse failure.
    """
    text = reply.strip()
    # Strip markdown code fences (e.g. ```json ... ```)
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        else:
            text = text.lstrip("`")
        if text.rstrip().endswith("```"):
            text = text.rstrip().rstrip("`")
        text = text.strip()

    parsed = None
    try:
        parsed = json.loads(text)
    except Exception:
        # Handle a JSON object embedded in surrounding text
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(text[start:end + 1])
            except Exception:
                parsed = None

    if isinstance(parsed, dict):
        tc = parsed.get("tool_call")
        if isinstance(tc, dict) and isinstance(tc.get("name"), str):
            args = tc.get("arguments")
            if args is None:
                args = {}
            if isinstance(args, dict):
                return AIMessage(
                    content="",
                    tool_calls=[{
                        "name": tc["name"],
                        "args": args,
                        "id": f"call_{uuid4().hex[:12]}",
                        "type": "tool_call",
                    }],
                )

    return AIMessage(content=reply)


class ChatHelix(BaseChatModel):
    """
    LangChain BaseChatModel backed by the Helix conversation API.

    helix_api_key is optional at construction — if blank, the loader falls
    back to <helix_agent_id>.json in repo root / ~/Documents / ~/Downloads
    (same search order as demo_api_server/services/helixAgentKeyLoader.js).
    """

    helix_base_url: str = Field(..., description="Helix tenant origin URL")
    helix_api_key: str = Field(default="", description="Helix API key (agent-scoped); auto-loaded from <agent_id>.json if blank")
    helix_environment_id: str = Field(..., description="Helix environment UUID")
    helix_agent_id: str = Field(..., description="Helix agent name (case-sensitive)")
    helix_prompt_field_id: str = Field(..., description="Input field ID inside the AI Task node")

    @property
    def _llm_type(self) -> str:
        return "helix"

    def _resolve_api_key(self) -> str:
        """Return the API key — explicit field wins, then auto-load from JSON file."""
        if self.helix_api_key:
            return self.helix_api_key
        from .helix_key_loader import load_agent_key
        key = load_agent_key(self.helix_agent_id)
        if not key:
            raise RuntimeError(
                f"No Helix API key found for agent '{self.helix_agent_id}'. "
                f"Set HELIX_API_KEY or drop {self.helix_agent_id}.json in the repo root / ~/Documents / ~/Downloads. "
                "The key must be agent-scoped (scope='agent') — env_admin keys return null."
            )
        return key

    def bind_tools(self, tools: Sequence[Any], **kwargs: Any) -> Runnable:
        """
        Bind tools for prompt-mediated tool calling.

        Helix has no native tool-call API, so tools are converted to the
        OpenAI tool schema and passed through to _generate/_agenerate, where
        they are rendered into the prompt as a TOOLS section.
        """
        converted = [convert_to_openai_tool(tool) for tool in tools]
        return self.bind(tools=converted, **kwargs)

    # ------------------------------------------------------------------
    # Internal async implementation
    # ------------------------------------------------------------------

    async def _call_helix_async(
        self,
        messages: List[BaseMessage],
        tools: Optional[Sequence[dict]] = None,
    ) -> str:
        """Call the Helix conversation API and return the agent's text reply."""
        api_key = self._resolve_api_key()
        base = _api_base(self.helix_base_url)
        headers_json = {"Content-Type": "application/json", "x-api-key": api_key}
        prompt = _build_prompt(messages, tools)

        async with httpx.AsyncClient(timeout=60.0) as client:
            # Step 1 — create conversation
            conv_url = f"{base}/environments/{self.helix_environment_id}/agents/{self.helix_agent_id}/conversations"
            logger.debug("Helix: creating conversation at %s", conv_url)
            conv_resp = await client.post(conv_url, headers=headers_json, json={"agent": {"version": "published"}})
            if conv_resp.status_code != 200 and conv_resp.status_code != 201:
                raise RuntimeError(f"Helix createConversation failed: {conv_resp.status_code} {conv_resp.text}")
            conv = conv_resp.json()
            if not conv or not conv.get("id"):
                raise RuntimeError(
                    "Helix createConversation returned null — check agent name, key scope, and published version"
                )
            conversation_id = conv["id"]
            channel_id = conv.get("home_channel", "default")
            logger.debug("Helix: conversation %s channel %s", conversation_id, channel_id)

            # Step 2 — post message
            msg_url = f"{base}/environments/{self.helix_environment_id}/conversations/{conversation_id}/channels/{channel_id}/messages"
            msg_headers = {**headers_json, "Content-Type": "application/json; async=false"}
            body = {"class": "start", "content": {self.helix_prompt_field_id: prompt}}
            msg_resp = await client.post(msg_url, headers=msg_headers, json=body)
            if not msg_resp.is_success:
                raise RuntimeError(f"Helix sendMessage failed: {msg_resp.status_code} {msg_resp.text}")
            msg_data = msg_resp.json()
            query_message_id = msg_data.get("message_id") or msg_data.get("id")

            # Check if POST response already contains the answer (immediate mode)
            immediate = _extract_value(msg_data)
            if immediate is not None:
                logger.debug("Helix: immediate response received")
                return immediate

            # Step 3 — poll for agent response
            logger.debug("Helix: polling for response (timeout=%ds)", POLL_TIMEOUT_SECONDS)
            deadline = asyncio.get_event_loop().time() + POLL_TIMEOUT_SECONDS
            while asyncio.get_event_loop().time() < deadline:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                poll_resp = await client.get(msg_url, headers={"x-api-key": api_key})
                if not poll_resp.is_success:
                    raise RuntimeError(f"Helix poll failed: {poll_resp.status_code} {poll_resp.text}")
                data = poll_resp.json()
                # Look for agent message that isn't the one we posted
                if isinstance(data, list):
                    for m in data:
                        if (
                            isinstance(m, dict)
                            and m.get("sender_role") == "agent"
                            and m.get("message_id") != query_message_id
                            and m.get("value") is not None
                        ):
                            result = _extract_value(m)
                            if result is not None:
                                logger.debug("Helix: agent reply received (poll)")
                                return result
                # Fall back to top-level extraction
                result = _extract_value(data)
                if result is not None:
                    return result

        raise TimeoutError(f"Timed out waiting for Helix response (agent={self.helix_agent_id})")

    # ------------------------------------------------------------------
    # LangChain interface — sync wrapper around async implementation
    # ------------------------------------------------------------------

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Sync entry point — runs the async implementation in a new event loop."""
        tools = kwargs.get("tools")
        try:
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = None
            if loop is not None and loop.is_running():
                # We are on a running event-loop thread (e.g. FastAPI). A sync
                # .invoke() here cannot await the Helix round-trip (create-
                # conversation + up to POLL_TIMEOUT_SECONDS of 1s polling)
                # without blocking the loop and starving every other session's
                # SSE/WebSocket traffic — that block is inherent to returning a
                # synchronous result, so there is no non-blocking sync path.
                # Refuse and direct callers to the async API, which never blocks
                # the loop. All in-repo callers already use ainvoke/astream.
                raise RuntimeError(
                    "ChatHelix._generate() was called on a running event loop. "
                    "Call the model via its async API (ainvoke / astream) instead "
                    "— _agenerate performs the Helix round-trip without blocking "
                    "the event loop."
                )
            elif loop is not None:
                content = loop.run_until_complete(self._call_helix_async(messages, tools=tools))
            else:
                content = asyncio.run(self._call_helix_async(messages, tools=tools))
        except Exception as exc:
            logger.error("Helix _generate error: %s", exc)
            raise

        message = _parse_reply(content) if tools else AIMessage(content=content)
        return ChatResult(generations=[ChatGeneration(message=message)])

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        """Async entry point used by LangGraph graph.ainvoke()."""
        tools = kwargs.get("tools")
        content = await self._call_helix_async(messages, tools=tools)
        message = _parse_reply(content) if tools else AIMessage(content=content)
        return ChatResult(generations=[ChatGeneration(message=message)])
