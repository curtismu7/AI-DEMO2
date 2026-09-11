"""
Message processor for the AG-UI /run path.
"""
import logging
import json
from typing import Optional

from agent.langchain_mcp_agent import LangChainMCPAgent, _content_to_text
from agent.grounding_guardrail import (
    CommitmentGroundingValidator,
    ToolCallRecord,
    contains_commitment_claim,
)
from guardrails.validator_base import FailResult


logger = logging.getLogger(__name__)


# Authorization / gateway policy-denial error codes the BFF surfaces in a denied
# tool result — the full set across every deny use case (gateway policy, scope,
# audience, exchange-scope, transaction, cross-owner), not just weather. Kept in
# sync with the deny bodies emitted by mcpToolPipeline / mcpGatewayClient /
# attackSimulatorService. Deliberately EXCLUDES non-denials the user should retry
# rather than see as "denied": authorization_pending (CIBA), mcp_authorize_error/
# _internal/_unavailable, authorization_service_unavailable.
_POLICY_DENY_CODES = (
    "gateway_policy_denied",
    "weather_scope_denied",
    "mcp_authorization_denied",
    "mcp_scope_denied",
    "gateway_auth_failed",
    "access_denied",
    "insufficient_scope",
    "invalid_scope",
    "missing_exchange_scopes",
    "transaction_denied",
)


def _tool_result_text(output) -> str:
    """The tool's own result string, unwrapped from whatever the event stream
    delivered it in.

    LangGraph's ToolNode hands ``on_tool_end`` a ToolMessage, not the tool's raw
    return, so ``str(output)`` yields a repr — ``content='{"...}' name='checkout'
    tool_call_id='tc1'`` — whose JSON never parses. Every consumer below reads
    these results as JSON, so capturing the repr silently disabled all of them:
    the HITL gate returned None and became LLM narration, and policy denials
    fell back to their generic sentence instead of the BFF's real reason.
    """
    content = getattr(output, "content", None)
    if isinstance(content, str):
        return content
    return str(output or "")


def _extract_policy_denial(tool_calls) -> Optional[str]:
    """Return a human-readable reason if any tool result this turn was an
    authorization / gateway policy denial, else None. The BFF returns the denied
    tool result as a JSON string carrying an ``error`` code plus a descriptive
    ``message`` (see bff_tool_adapter._arun)."""
    for rec in tool_calls or []:
        result = str(getattr(rec, "result", "") or "")
        if not any(code in result for code in _POLICY_DENY_CODES):
            continue
        try:
            data = json.loads(result)
            if isinstance(data, dict):
                msg = data.get("message") or data.get("error_description") or data.get("error")
                if isinstance(msg, str) and msg.strip():
                    return msg.strip()
        except (ValueError, TypeError):
            pass
        return "The request was denied by an authorization policy."
    return None


def _extract_hitl_interrupt(tool_calls) -> Optional[dict]:
    """Return the interrupt payload if a tool this turn needs human approval.

    The BFF normalizes a 428 approval gate into ``result.hitlRequired`` +
    ``interruptId`` (routes/agentTool.js). A gate is a PAUSE, not a failure, so
    it must end the turn as an AG-UI interrupt rather than becoming another
    observation for the LLM to narrate — otherwise the challenge is created and
    nobody is ever shown a modal to approve it.

    Deliberately distinct from _extract_policy_denial: a DENY is terminal and
    keeps its deterministic notice; only an approval gate pauses the run.
    """
    for rec in tool_calls or []:
        result = str(getattr(rec, "result", "") or "")
        if "hitlRequired" not in result:
            continue
        try:
            data = json.loads(result)
        except (ValueError, TypeError):
            continue
        if isinstance(data, dict) and data.get("hitlRequired"):
            return data
    return None


def _reply_surfaces_denial(reply: str) -> bool:
    """Heuristic: did the model's reply already explain the denial? Prevents
    doubling the deterministic notice when the system-prompt rule worked. A
    greeting or subject-change contains none of these terms."""
    r = (reply or "").lower()
    if not r.strip():
        return False
    return any(kw in r for kw in ("den", "block", "not allow", "scope", "policy", "restrict", "out of"))


class MessageProcessor:
    """Runs one AG-UI /run turn through the LangChain agent and streams it to the emitter."""

    def __init__(self, agent: LangChainMCPAgent):
        self.agent = agent

    async def process_agui_message(
        self,
        session_id: str,
        message: str,
        auth_token: str,
        emitter,  # AGUIEventEmitter
        vertical_flavor: str = None,
        bff_tool_url: str = "",
        tool_schemas: list = None,
        messages_list: list = None,
        run_provider: str = None,
        run_model: str = None,
        user_identity: dict = None,
        run_id: str = "",
    ) -> None:
        """Process one agent turn and emit AG-UI events via the provided emitter.

        on_run_start / on_run_end are NOT called here -- the /run endpoint
        handles those before and after this method.

        Session identity is resolved from auth_token on every call so that
        stateless /run requests work without a prior session_init handshake.
        If the session is already identified (e.g. a second turn in the same
        SSE connection) the call is a no-op because initialize_session_with_token
        writes into conversation_memory which is idempotent on re-writes.

        When bff_tool_url is non-empty, uses a stateless per-run graph with BFF
        tools (RFC 8693 exchange happens in the BFF; tokenEvents flow back as
        STATE_DELTA). Otherwise falls through to the standard MCP graph path.

        Args:
            session_id: Conversation thread ID.
            message: The user message text for this turn.
            auth_token: PingOne access token (BFF-resolved; never browser-supplied).
            emitter: AGUIEventEmitter instance owned by the /run endpoint.
            bff_tool_url: When set, use BFF tool wiring instead of direct MCP.
            tool_schemas: Tool schema list from the BFF /run payload.
            messages_list: Full conversation history from the BFF (list of
                {role, content} dicts). Used as input for the stateless BFF path.
        """
        from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
        from langchain_core.runnables import RunnableConfig

        # 1. Establish token-derived identity.
        if auth_token:
            await self.agent.initialize_session_with_token(session_id, auth_token)
        elif user_identity and user_identity.get("userId"):
            # BFF-tool path: identity is asserted by the BFF after the gateway
            # secret middleware authenticated the caller. Only accept a plain
            # string userId (reject objects/lists) and ignore a mismatched
            # sessionId claim if the BFF included one.
            uid = user_identity.get("userId")
            claimed_sid = user_identity.get("sessionId") or user_identity.get("session_id")
            if not isinstance(uid, str) or not uid.strip():
                logger.warning(
                    "[AG-UI] Ignoring non-string user_identity.userId for session %s",
                    session_id,
                )
            elif claimed_sid and str(claimed_sid) != str(session_id):
                logger.warning(
                    "[AG-UI] Ignoring user_identity with mismatched sessionId for session %s",
                    session_id,
                )
            else:
                await self.agent.conversation_memory.set_user_identified(
                    session_id,
                    user_identity.get("email") or "unknown",
                    uid.strip(),
                )
        else:
            logger.warning(
                "[AG-UI] process_agui_message called without auth_token or user_identity for session %s",
                session_id,
            )

        # 2. Determine which graph and input to use.
        # Per-run LLM: when the BFF sends a specific provider (e.g. 'anthropic-lmstudio'
        # from agent_mode=lmstudio), create a fresh LLM for this run instead of using
        # the startup-configured one. Keeps the agent instance reusable across modes.
        _LMSTUDIO_PROVIDERS = frozenset(["anthropic-lmstudio", "lmstudio"])
        _CLAUDE_PROVIDERS = frozenset(["anthropic"])
        _LLAMACPP_PROVIDERS = frozenset(["llamacpp"])
        _HELIX_PROVIDERS = frozenset(["helix"])
        _GROQ_PROVIDERS = frozenset(["groq"])
        _GOOGLE_PROVIDERS = frozenset(["google"])
        run_llm = self.agent.llm
        # True once a per-run provider actually produced its own LLM, so the MCP
        # graph path below knows to rebuild instead of reusing the startup graph.
        run_llm_overridden = False
        if run_provider and (run_provider in _LMSTUDIO_PROVIDERS or run_provider in _CLAUDE_PROVIDERS
                             or run_provider in _LLAMACPP_PROVIDERS or run_provider in _HELIX_PROVIDERS
                             or run_provider in _GROQ_PROVIDERS or run_provider in _GOOGLE_PROVIDERS):
            try:
                from agent.llm_factory import get_llm
                import os
                lc = self.agent.config.langchain
                if run_provider in _LLAMACPP_PROVIDERS:
                    run_llm = get_llm(
                        provider="llamacpp",
                        model=run_model or None,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        llamacpp_base_url=getattr(lc, "llamacpp_base_url", "http://127.0.0.1:8090"),
                        llamacpp_model=getattr(lc, "llamacpp_model", "phi-4-mini-instruct"),
                    )
                elif run_provider in _LMSTUDIO_PROVIDERS:
                    run_llm = get_llm(
                        provider=run_provider,
                        model=run_model or None,
                        api_key="lm-studio",
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        lmstudio_base_url=getattr(lc, "lmstudio_base_url", "http://localhost:1234/v1"),
                    )
                elif run_provider in _HELIX_PROVIDERS:
                    # Helix — tenant-specific config carried on the agent's
                    # LangChainConfig (no env fallbacks; get_llm raises if unset).
                    run_llm = get_llm(
                        provider="helix",
                        model=run_model or None,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        helix_base_url=getattr(lc, "helix_base_url", ""),
                        helix_api_key=getattr(lc, "helix_api_key", ""),
                        helix_environment_id=getattr(lc, "helix_environment_id", ""),
                        helix_agent_id=getattr(lc, "helix_agent_id", ""),
                        helix_prompt_field_id=getattr(lc, "helix_prompt_field_id", ""),
                    )
                elif run_provider in _GROQ_PROVIDERS:
                    # GroqCloud — real key required (billed cloud API); no env
                    # fallback default, get_llm() raises if unset.
                    run_llm = get_llm(
                        provider="groq",
                        model=run_model or getattr(lc, "groq_model", None) or None,
                        api_key=getattr(lc, "groq_api_key", "") or os.environ.get("GROQ_API_KEY", ""),
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        groq_base_url=getattr(lc, "groq_base_url", "https://api.groq.com/openai/v1"),
                    )
                elif run_provider in _GOOGLE_PROVIDERS:
                    # Gemini — real key required (billed cloud API); no env
                    # fallback default, get_llm() raises if unset.
                    run_llm = get_llm(
                        provider="google",
                        model=run_model or getattr(lc, "google_model", None) or None,
                        api_key=getattr(lc, "google_api_key", "") or os.environ.get("GOOGLE_API_KEY", ""),
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                        google_base_url=getattr(lc, "google_base_url", "https://generativelanguage.googleapis.com/v1beta/openai/"),
                    )
                else:
                    # anthropic — use real Anthropic API key from env
                    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
                    run_llm = get_llm(
                        provider="anthropic",
                        model=run_model or None,
                        api_key=api_key,
                        temperature=lc.temperature,
                        max_tokens=lc.max_tokens,
                        streaming=bool(getattr(lc, "stream_llm_tokens", True)),
                    )
                run_llm_overridden = run_llm is not None and run_llm is not self.agent.llm
                logger.info("[AG-UI] per-run LLM override: provider=%s model=%s applied=%s",
                            run_provider, run_model or "auto", run_llm_overridden)
            except Exception as _llm_err:
                logger.warning("[AG-UI] per-run LLM init failed (%s), using default", _llm_err)
                run_llm = self.agent.llm

        if bff_tool_url and tool_schemas:
            # ── BFF tool path ──────────────────────────────────────────────────
            # Build a stateless per-run graph so RFC 8693 token exchange happens
            # inside the BFF /internal/agent-tool call (not bypassed via MCP WS).
            if run_llm is None:
                _no_llm_msg = (
                    "No LLM is configured (LANGCHAIN_LLM_PROVIDER=none). "
                    "Set LANGCHAIN_LLM_PROVIDER in langchain_agent/.env to enable AI responses."
                )
                await emitter.on_llm_start()
                await emitter.on_llm_new_token(_no_llm_msg)
                await emitter.on_llm_end()
                return
            from agui.bff_tool_adapter import build_bff_tools
            from langgraph.prebuilt import create_react_agent

            bff_tools = build_bff_tools(
                tool_schemas, bff_tool_url, session_id, emitter._sink, run_id=run_id
            )
            # F2: bound the BFF-path prompt the same way the startup MCP graph
            # does. Without this hook the full AG-UI history is replayed every
            # turn, so a long chat grows unbounded and eventually overflows the
            # context window. Reuse the agent's existing token-trimming hook.
            active_graph = create_react_agent(
                run_llm, bff_tools, pre_model_hook=self.agent._pre_model_hook
            )
            active_config = RunnableConfig(
                recursion_limit=getattr(self.agent.config.langchain, "max_iterations", 25),
            )

            # Convert the full conversation history (all messages from the BFF
            # request, including the current turn) to LangChain message objects.
            def _to_lc(msgs):
                result = []
                for m in msgs:
                    role = m.get("role", "user")
                    content = m.get("content", "")
                    if isinstance(content, list):
                        content = " ".join(
                            c.get("text", "") for c in content
                            if isinstance(c, dict) and c.get("type") == "text"
                        )
                    if role == "user":
                        result.append(HumanMessage(content=content))
                    elif role == "assistant":
                        result.append(AIMessage(content=content))
                    elif role == "system":
                        result.append(SystemMessage(content=content))
                return result

            hist = _to_lc(messages_list or [])
            # Prepend a system message on the first turn if the history doesn't
            # already start with one.
            if not hist or not isinstance(hist[0], SystemMessage):
                system_text = await self.agent._build_system_message(
                    session_id, vertical_flavor=vertical_flavor
                )
                hist = [SystemMessage(content=system_text)] + hist

            agent_input = {"messages": hist}
            logger.info(
                "[AG-UI] BFF tool path session=%s tools=%d msgs=%d",
                session_id, len(bff_tools), len(hist),
            )
        else:
            # ── MCP graph path (existing) ──────────────────────────────────────
            # Honor the per-run LLM override on this path too. The startup graph
            # is bound to self.agent.llm (which may be None when
            # LANGCHAIN_LLM_PROVIDER=none); when the user picked a different
            # provider for this run, build a graph from run_llm over the MCP
            # tools + shared checkpointer so the selection isn't silently ignored
            # (and the "No LLM configured" message isn't shown despite a choice).
            if run_llm_overridden:
                if not self.agent._tools:
                    try:
                        self.agent._tools = await self.agent.mcp_tool_provider.get_langchain_tools()
                    except Exception:
                        logger.warning("[AG-UI] MCP tool load failed for per-run graph; running tool-less")
                        self.agent._tools = self.agent._tools or []
                from langgraph.prebuilt import create_react_agent as _create_react_agent
                active_graph = _create_react_agent(
                    model=run_llm,
                    tools=self.agent._tools,
                    pre_model_hook=self.agent._pre_model_hook,
                    checkpointer=self.agent._checkpointer,
                )
                logger.info("[AG-UI] MCP path using per-run LLM override (provider=%s)", run_provider)
            else:
                if not self.agent._graph:
                    await self.agent.initialize_tools()
                    if not self.agent._graph:
                        if self.agent.llm is None:
                            _no_llm_msg = (
                                "No LLM is configured (LANGCHAIN_LLM_PROVIDER=none). "
                                "Set LANGCHAIN_LLM_PROVIDER in langchain_agent/.env to enable AI responses."
                            )
                            await emitter.on_llm_start()
                            await emitter.on_llm_new_token(_no_llm_msg)
                            await emitter.on_llm_end()
                            return
                        raise RuntimeError("Agent graph failed to initialise")
                active_graph = self.agent._graph

            # Inject SystemMessage only on the first turn.
            try:
                graph_state = active_graph.get_state(
                    {"configurable": {"thread_id": session_id}}
                )
                has_prior_history = bool(graph_state.values.get("messages"))
            except Exception:
                has_prior_history = False

            if has_prior_history:
                msgs_for_graph = [HumanMessage(content=message)]
            else:
                system_msg_text = await self.agent._build_system_message(
                    session_id, vertical_flavor=vertical_flavor
                )
                msgs_for_graph = [
                    SystemMessage(content=system_msg_text),
                    HumanMessage(content=message),
                ]

            await self.agent.mcp_tool_provider.set_session_context(session_id)

            active_config = RunnableConfig(
                configurable={"thread_id": session_id},
                recursion_limit=getattr(self.agent.config.langchain, "max_iterations", 25),
            )
            agent_input = {"messages": msgs_for_graph}

        # 3. Stream events from the chosen graph and route to the emitter.
        llm_streaming = False
        total_input_tokens = 0
        total_output_tokens = 0
        turn_reply_text = ""
        pending_tool_calls: dict = {}
        turn_tool_calls: list = []
        # True once the run has produced ANYTHING the user can see (streamed
        # text, a single-shot fallback message, or a tool call). A model that
        # returns empty content and calls no tool -- seen intermittently with
        # Groq on ambiguous prompts -- otherwise leaves the user staring at a
        # blank chat with no error and no explanation.
        any_visible_output = False

        async for event in active_graph.astream_events(
            agent_input, config=active_config, version="v2"
        ):
            event_name = event.get("event")
            event_data = event.get("data") or {}

            if event_name == "on_chat_model_stream":
                chunk = event_data.get("chunk")
                # Flatten provider content: OpenAI-style models stream a str,
                # Anthropic-style providers stream a list of content blocks.
                # Without this the delta is a list that JSON-serializes and
                # renders client-side as "[object Object]".
                token = _content_to_text(getattr(chunk, "content", "")) if chunk is not None else ""
                if token:
                    if not llm_streaming:
                        await emitter.on_llm_start()
                        llm_streaming = True
                    await emitter.on_llm_new_token(token)
                    turn_reply_text += token
                    any_visible_output = True

            elif event_name == "on_chat_model_end":
                output = event_data.get("output")
                # Some providers (e.g. ChatHelix, whose API is poll-based, not
                # SSE) never emit on_chat_model_stream chunks, so llm_streaming
                # stays False and the visible chat bubble is never created —
                # the final text only reaches on_llm_detail (debug panel), not
                # the user. Surface it here as a single-shot message instead.
                if not llm_streaming and output is not None:
                    final_text = _content_to_text(getattr(output, "content", ""))
                    if final_text:
                        await emitter.on_llm_start()
                        await emitter.on_llm_new_token(final_text)
                        await emitter.on_llm_end()
                        any_visible_output = True
                        # Capture the single-shot reply too so the policy-denial
                        # fallback below can tell whether the model already
                        # explained the denial (the streaming path accumulates it
                        # via on_chat_model_stream; this non-streaming path did not).
                        turn_reply_text += final_text
                if output and (usage := getattr(output, "usage_metadata", None)):
                    # usage_metadata is a TypedDict (plain dict at runtime), so
                    # attribute access always yields the default 0 — read keys.
                    if isinstance(usage, dict):
                        total_input_tokens += usage.get("input_tokens", 0) or 0
                        total_output_tokens += usage.get("output_tokens", 0) or 0
                    else:
                        total_input_tokens += getattr(usage, "input_tokens", 0) or 0
                        total_output_tokens += getattr(usage, "output_tokens", 0) or 0

                try:
                    _msgs = event_data.get("input", {}).get("messages") or []
                    _flat = []
                    for _group in _msgs:
                        for _m in (_group if isinstance(_group, list) else [_group]):
                            _flat.append({
                                "role": getattr(_m, "type", None) or getattr(_m, "role", "?"),
                                "content": str(getattr(_m, "content", ""))[:600],
                            })
                    _tool_calls = list(getattr(output, "tool_calls", None) or [])
                    await emitter.on_llm_detail(
                        model=event.get("metadata", {}).get("ls_model_name", "unknown"),
                        messages=_flat,
                        tool_calls=_tool_calls,
                        usage={
                            "inputTokens": total_input_tokens,
                            "outputTokens": total_output_tokens,
                        },
                    )
                except Exception:
                    logger.exception("llm_detail emission failed (non-fatal)")

            elif event_name == "on_tool_start":
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                serialized = {"name": event.get("name", "unknown_tool")}
                tool_call_id = event.get("run_id")
                pending_tool_calls[tool_call_id] = {
                    "name": event.get("name", "unknown_tool"),
                    "args": event_data.get("input"),
                }
                any_visible_output = True
                await emitter.on_tool_start(
                    serialized,
                    tool_call_id=tool_call_id,
                    inputs=event_data.get("input"),
                )

            elif event_name == "on_tool_end":
                output = event_data.get("output", "")
                tool_call_id = event.get("run_id")
                pending = pending_tool_calls.pop(tool_call_id, None)
                if pending is not None:
                    turn_tool_calls.append(
                        ToolCallRecord(
                            name=pending["name"],
                            args=pending["args"],
                            result=_tool_result_text(output),
                        )
                    )
                await emitter.on_tool_end(output, tool_call_id=tool_call_id)

            elif event_name == "on_chain_error":
                error = event_data.get("error") or RuntimeError("Agent chain error")
                if llm_streaming:
                    await emitter.on_llm_end()
                    llm_streaming = False
                await emitter.on_error(error)
                return  # on_error emits RUN_FINISHED; avoid double RUN_FINISHED from caller

        # 4. Close the LLM message if it was still open at stream end.
        if llm_streaming:
            await emitter.on_llm_end()

        # An approval gate ends the turn as an interrupt. The model has already
        # said its piece above (usually "I've submitted the request"), but the
        # run must STOP here rather than fall through to a plain RUN_FINISHED —
        # that is the only event the SPA turns into a consent modal, and without
        # it the challenge is created and never approvable.
        _interrupt = _extract_hitl_interrupt(turn_tool_calls)
        if _interrupt:
            logger.info(
                "[AG-UI] turn interrupted for human approval (tool=%s challenge=%s)",
                _interrupt.get("tool"), _interrupt.get("interruptId"),
            )
            await emitter.on_hitl_interrupt(_interrupt)
            return  # on_hitl_interrupt emits the terminal RUN_FINISHED

        # Deterministic policy-denial fallback: if a tool was blocked by an
        # authorization / gateway policy but the model's reply never surfaced it
        # (e.g. the banking persona greeted or changed the subject), state the
        # denial plainly as its own message — parity with the in-process
        # heuristic path's "❌ <reason>" so the user always sees WHY it was
        # blocked, regardless of what the LLM chose to say. Rule 21 in the system
        # prompt steers the normal case; this guarantees the tail case.
        _denial = _extract_policy_denial(turn_tool_calls)
        if _denial and not _reply_surfaces_denial(turn_reply_text):
            _notice = f"❌ {_denial}"
            await emitter.on_llm_start()
            await emitter.on_llm_new_token(_notice)
            await emitter.on_llm_end()
            turn_reply_text += ("\n" if turn_reply_text else "") + _notice
            any_visible_output = True

        if not any_visible_output:
            logger.warning(
                "[AG-UI] run produced no visible output (no text, no tool call) for session %s",
                session_id,
            )
            await emitter.on_error(RuntimeError(
                "The model didn't return a usable response. Try rephrasing your "
                "request or sending it again."
            ))
            return

        if contains_commitment_claim(turn_reply_text):
            try:
                async def _chat_fn(prompt: str) -> str:
                    resp = await run_llm.ainvoke([HumanMessage(content=prompt)])
                    return _content_to_text(getattr(resp, "content", ""))

                validator = CommitmentGroundingValidator(chat_fn=_chat_fn, on_fail="fix")
                check = await validator.async_validate(
                    turn_reply_text, {"tool_calls": turn_tool_calls}
                )
                if isinstance(check, FailResult):
                    await emitter.on_grounding_correction(
                        original=turn_reply_text,
                        corrected=check.fix_value,
                        note=check.error_message,
                    )
            except Exception:
                # Fail open on ANY error in the grounding-check block (not
                # just the LLM call, which the validator itself already
                # fails open on internally) -- e.g. CommitmentGroundingValidator
                # construction raising ValueError when ~/.guardrailsrc is
                # missing. Never block or alter an already-streamed reply on
                # a grounding-check error.
                logger.exception("[grounding] guardrail check failed; failing open")

        if total_input_tokens or total_output_tokens:
            await emitter.on_usage(total_input_tokens, total_output_tokens)

        logger.info("[AG-UI] process_agui_message complete for session %s", session_id)
