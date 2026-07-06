"""Native LlamaIndex retrieval over the existing Weaviate `CodeChunk` class.

Correctness gates:
  * query embeddings MUST use the same nomic-embed-text-v1.5 model that
    code-search used to write vectors (768-dim), or ANN is meaningless.
  * `CodeChunk` was created by the code-search service, not LlamaIndex, so we
    pin index_name + text_key and reconstruct nodes from the text field.
"""
import os
from urllib.parse import urlparse

CLASS_NAME = "CodeChunk"
TEXT_KEY = "snippet"


def connect_weaviate():
    """Connect to the existing code-search Weaviate instance (weaviate-client v4)."""
    import weaviate

    url = os.getenv("WEAVIATE_URL", "http://weaviate:8080")
    p = urlparse(url)
    host = p.hostname or "weaviate"
    http_port = p.port or 8080
    # weaviate-client v4 needs gRPC too (default 50051, internal to the network).
    grpc_port = int(os.getenv("WEAVIATE_GRPC_PORT", "50051"))
    client = weaviate.connect_to_custom(
        http_host=host, http_port=http_port, http_secure=False,
        grpc_host=host, grpc_port=grpc_port, grpc_secure=False,
        skip_init_checks=True,
    )
    return client


def make_embed_model():
    """Embed model pinned to the same nomic-embed-text-v1.5 service used at index time."""
    from llama_index.embeddings.openai_like import OpenAILikeEmbedding

    base = os.getenv("EMBEDDING_URL", "http://embeddings:8080").rstrip("/")
    return OpenAILikeEmbedding(
        model_name=os.getenv("EMBEDDING_MODEL", "nomic-embed-text-v1.5"),
        api_base=f"{base}/v1",
        api_key="not-needed",
        embed_batch_size=16,
    )


def build_index():
    """Wrap the existing CodeChunk class as a VectorStoreIndex (no re-indexing)."""
    from llama_index.core import VectorStoreIndex
    from llama_index.vector_stores.weaviate import WeaviateVectorStore

    client = connect_weaviate()
    vector_store = WeaviateVectorStore(
        weaviate_client=client,
        index_name=CLASS_NAME,
        text_key=TEXT_KEY,
    )
    return VectorStoreIndex.from_vector_store(
        vector_store, embed_model=make_embed_model()
    )


def _codebase_filter(codebase_id: str):
    from llama_index.core.vector_stores.types import (
        MetadataFilters, MetadataFilter, FilterOperator,
    )

    return MetadataFilters(filters=[
        MetadataFilter(key="codebase_id", value=codebase_id,
                       operator=FilterOperator.EQ),
    ])


def retrieve(index, question: str, codebase_id: str, limit: int = 8) -> list:
    """Retrieve CodeChunk hits for `question`, scoped to `codebase_id`.

    Returns a list of dicts: {file, line_start, line_end, snippet}.
    """
    retriever = index.as_retriever(
        similarity_top_k=limit, filters=_codebase_filter(codebase_id),
    )
    nodes = retriever.retrieve(question)
    out = []
    for n in nodes:
        md = n.node.metadata or {}
        out.append({
            "file": md.get("file", ""),
            "line_start": md.get("line_start"),
            "line_end": md.get("line_end"),
            "snippet": n.node.get_content(),
        })
    return out
