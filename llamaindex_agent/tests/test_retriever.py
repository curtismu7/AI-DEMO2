import os
import pytest

WEAVIATE_URL = os.getenv("WEAVIATE_URL", "http://localhost:8080")


def _reachable():
    import httpx
    try:
        return httpx.get(f"{WEAVIATE_URL}/v1/meta", timeout=2).status_code == 200
    except Exception:
        return False


@pytest.mark.skipif(not _reachable(), reason="Weaviate not reachable")
def test_known_query_returns_expected_file():
    from retriever import build_index, retrieve
    index = build_index()
    # After the default index exists, a query about the embedder must surface
    # the embeddings config. Adjust the expected token to a file known to exist.
    hits = retrieve(index, "nomic embedding model configuration",
                    codebase_id="ai-demo2-default", limit=5)
    assert len(hits) > 0
    # Metadata must actually reconstruct from the foreign CodeChunk class — a
    # non-empty file/line proves the WeaviateVectorStore mapping worked, not just
    # that the text field came back. (Guards the `_node_content` risk.)
    assert all(h.get("file") and h.get("line_start") is not None for h in hits), \
        f"sources missing file/line metadata (foreign-class mapping failed): {hits}"
    assert all("snippet" in h and h["snippet"] for h in hits)
    # Correctness gate: results are about embeddings, not random files.
    assert any("embed" in h["file"].lower() or "embed" in h["snippet"].lower()
               for h in hits)
