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
        max_tokens=800,
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
            return {"answer": answer, "sources": _dedup(collected),
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
    return {"answer": str(completion), "sources": _dedup(hits),
            "toolCalls": 1 if hits else 0, "mode": "single-shot"}
