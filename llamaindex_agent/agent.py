"""LlamaIndex tool-calling agent over the CodeChunk index.

The LLM is given a `search_code` tool (native Weaviate retrieval, codebase_id
bound server-side) and decides when to call it. Bounded by AGENT_MAX_TOOL_CALLS.
Degrades to a single retrieval + answer when the model can't tool-call.

Heavy imports (llama_index, retriever) are deferred inside functions so this
module can be imported (e.g. for test monkeypatching) without llama-index
installed — mirrors the pattern used in retriever.py.
"""
import os

_MAX_TOOLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "4"))

_index = None


def _get_index():
    global _index
    if _index is None:
        from retriever import build_index
        _index = build_index()
    return _index


def _make_llm():
    from llama_index.llms.openai_like import OpenAILike

    base = os.getenv("LLAMACPP_BASE_URL", "http://llm-proxy:8090").rstrip("/")
    return OpenAILike(
        model=os.getenv("AGENT_MODEL", "local"),
        api_base=f"{base}/v1",
        api_key="not-needed",
        is_chat_model=True,
        is_function_calling_model=True,
        temperature=0.1,
        # Reasoning models (gpt-oss via the swap-mode proxy) spend most of the
        # budget on reasoning_content before emitting any visible answer —
        # 800 tokens regularly produced an EMPTY content string.
        max_tokens=int(os.getenv("AGENT_MAX_TOKENS", "3000")),
        # SE cluster often only runs the large tier (~8–10 t/s). Default HTTP
        # client timeout (60s) aborts mid-generation → UI "assistant unavailable".
        timeout=float(os.getenv("AGENT_LLM_TIMEOUT", "240")),
    )


SYSTEM = (
    "You are a code-search agent. Use the search_code tool to find relevant "
    "code before answering. You may call it multiple times to refine. Answer "
    "ONLY from retrieved snippets; cite sources as path:line_start-line_end; "
    "if the code isn't found, say so — never invent code."
)


def run_agent(question: str, codebase_id: str, limit: int = 8) -> dict:
    from llama_index.core.tools import FunctionTool
    from retriever import retrieve

    index = _get_index()
    collected: list[dict] = []

    def search_code(query: str) -> str:
        hits = retrieve(index, query, codebase_id=codebase_id, limit=limit)
        collected.extend(hits)
        if not hits:
            return "No matching code found."
        return "\n\n".join(
            f"[{h['file']}:{h['line_start']}-{h['line_end']}]\n{h['snippet']}"
            for h in hits
        )

    tool = FunctionTool.from_defaults(
        fn=search_code, name="search_code",
        description="Semantic search over the indexed codebase. Args: query (str).",
    )

    def _dedup(rows):
        seen, out = set(), []
        for h in rows:
            k = (h["file"], h["line_start"], h["line_end"])
            if k not in seen:
                seen.add(k); out.append(h)
        return out

    # AGENT_MODE=single-shot skips the ReAct tool loop (needed when only a slow
    # reasoning model is live — multiple tool rounds exceed BFF/UI timeouts).
    mode = (os.getenv("AGENT_MODE") or "agent").strip().lower()
    if mode != "single-shot":
        try:
            import asyncio
            from llama_index.core.agent.workflow import ReActAgent

            agent = ReActAgent(
                tools=[tool], llm=_make_llm(), system_prompt=SYSTEM, verbose=False,
            )
            handler = agent.run(user_msg=f"Question: {question}", max_iterations=_MAX_TOOLS)
            resp = asyncio.run(handler)
            answer = str(resp)
            if collected:
                # Best-effort on this path: a ReActAgent AgentOutput is not a raw
                # completion, so _is_truncated only fires when the underlying
                # payload is exposed. It never mislabels a good answer (unknown
                # shape → False).
                agent_truncated = _is_truncated(resp)
                if agent_truncated:
                    answer += TRUNCATION_NOTICE
                return {"answer": answer, "sources": _dedup(collected),
                        "truncated": agent_truncated or None,
                        "toolCalls": max(1, len(collected) // max(1, limit)),
                        "mode": "agent"}
            # Model answered without calling the tool → force one retrieval (grounding).
        except Exception:
            pass

    # single-shot fallback: retrieve once, answer with the same LLM.
    hits = retrieve(index, question, codebase_id=codebase_id, limit=limit)
    context = "\n\n".join(
        f"[{h['file']}:{h['line_start']}-{h['line_end']}]\n{h['snippet']}"
        for h in hits
    ) or "No matching code found."
    llm = _make_llm()
    completion = llm.complete(
        f"{SYSTEM}\n\nSnippets:\n{context}\n\nQuestion: {question}\nAnswer:"
    )
    answer = _completion_text(completion)
    truncated = _is_truncated(completion)
    if truncated:
        answer += TRUNCATION_NOTICE
    return {"answer": answer, "sources": _dedup(hits), "truncated": truncated or None,
            "toolCalls": 1 if hits else 0, "mode": "single-shot"}


TRUNCATION_NOTICE = (
    "\n\n⚠️ This answer was cut off — it reached the response length limit. "
    "Ask a narrower question, or raise the response limit (AGENT_MAX_TOKENS) "
    "if this keeps happening."
)


def _is_truncated(completion):
    """Did the model stop because it ran out of tokens rather than because it was done?

    A cut-off answer is otherwise indistinguishable from a complete one — it just
    stops mid-sentence. Reads the provider's own stop signal off the raw
    OpenAI-compatible payload (llama-server reports finish_reason 'length').
    Best-effort: any shape we do not recognise is treated as not truncated, so a
    normal answer is never mislabelled.
    """
    raw = getattr(completion, "raw", None)
    try:
        choice = raw["choices"][0] if isinstance(raw, dict) else raw.choices[0]
        finish = choice["finish_reason"] if isinstance(choice, dict) else choice.finish_reason
        return finish == "length"
    except Exception:
        return False


def _completion_text(completion):
    """Visible text of a completion, tolerating reasoning models.

    The swap-mode llm-proxy treats the request's model as a MINIMUM tier, so a
    loaded gpt-oss (reasoning model) legitimately serves phi-pinned requests —
    and it emits its work in `reasoning_content`, leaving `content` empty when
    the token budget runs out mid-reasoning. An empty answer with populated
    sources was exactly that. Prefer content; fall back to reasoning_content.
    """
    text = (str(completion) or "").strip()
    if text:
        return text
    raw = getattr(completion, "raw", None)
    try:
        choice = raw["choices"][0] if isinstance(raw, dict) else raw.choices[0]
        msg = choice["message"] if isinstance(choice, dict) else choice.message
        if isinstance(msg, dict):
            reasoning = msg.get("reasoning_content") or ""
        else:
            reasoning = getattr(msg, "reasoning_content", None) or (
                (getattr(msg, "model_extra", None) or {}).get("reasoning_content") or ""
            )
        return str(reasoning).strip()
    except Exception:
        return ""

