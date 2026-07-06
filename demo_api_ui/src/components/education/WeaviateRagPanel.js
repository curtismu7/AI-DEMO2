// demo_api_ui/src/components/education/WeaviateRagPanel.js
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

function WhatTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>What is a vector database?</h3>
      <p>
        A <strong>vector database</strong> stores each item alongside an{" "}
        <strong>embedding</strong> — a list of numbers that captures the item's
        meaning. Instead of matching exact keywords, it finds items whose vectors
        are <em>closest</em> in that meaning-space (approximate nearest-neighbor
        search, ANN). So a search for "auth logic" can surface code about{" "}
        <code>login</code>, <code>PKCE</code>, and <code>token</code> even when
        those exact words never appear in the query.
      </p>
      <p>
        <strong>Weaviate</strong> is the open-source vector database used in this
        demo. It stores vectors and does the nearest-neighbor search; it is the
        retrieval layer, not the model.
      </p>
    </div>
  );
}

function HereTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>How it's wired in this demo</h3>
      <p>
        Weaviate here is the store behind the <strong>Code Search</strong> page
        (<code>/code-search</code>). It runs in <strong>bring your own vectors</strong>{" "}
        mode (<code>DEFAULT_VECTORIZER_MODULE: none</code>) — it does{" "}
        <strong>no embedding itself</strong>. Embeddings come from a separate
        llama.cpp service running <code>nomic-embed-text-v1.5</code>.
      </p>
      <pre className="edu-code">{`
  Code Search page  ──HTTP──▶  code-search service
                                  │  1. chunk files
                                  │  2. embed each chunk
                                  ▼        (nomic-embed-text-v1.5, 768-dim)
                              embeddings (llama.cpp)
                                  │
                                  ▼  3. store vectors
                              Weaviate  (class: CodeChunk, vectorizer: none)
                                  ▲
                                  └── 4. query: embed question, nearest-neighbor`}</pre>
      <ul>
        <li><strong>Internal-only:</strong> Weaviate publishes no host port; it is reachable only as <code>http://weaviate:8080</code> on the compose network.</li>
        <li><strong>One class, <code>CodeChunk</code>:</strong> every chunk carries its <code>codebase_id</code>, <code>file</code>, line range, and <code>snippet</code>; searches filter by <code>codebase_id</code>.</li>
        <li><strong>Bring your own vectors:</strong> the code-search service supplies the embeddings, so Weaviate needs no vectorizer module.</li>
      </ul>
    </div>
  );
}

function FlowTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Index &amp; search</h3>
      <h4>Indexing (<code>POST /index</code>)</h4>
      <ol>
        <li>Split each file into overlapping line windows (chunks).</li>
        <li>Embed every chunk with <code>nomic-embed-text-v1.5</code> → a 768-dim vector.</li>
        <li>Upsert each chunk + its vector into the <code>CodeChunk</code> class.</li>
      </ol>
      <h4>Searching (<code>POST /search</code>)</h4>
      <ol>
        <li>Embed the query with the <em>same</em> model (so it lands in the same space).</li>
        <li>Ask Weaviate for the nearest vectors (HNSW ANN), filtered by <code>codebase_id</code>.</li>
        <li>Return the matching chunks, ranked by similarity, with file + line range.</li>
      </ol>
      <p>
        Using the <em>same</em> embedding model for indexing and querying is not
        optional — mismatched models put the query in a different space and the
        results become meaningless.
      </p>
    </div>
  );
}

function TryTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Try it</h3>
      <p>
        Open the <strong>Code Search</strong> page to see this in action: upload
        or select a codebase, then ask for something by meaning (e.g.{" "}
        <em>"find authentication logic"</em>) and watch semantically-related code
        come back even when the words differ.
      </p>
      <p>
        <a href="/code-search">Go to Code Search →</a>
      </p>
    </div>
  );
}

export default function WeaviateRagPanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    { id: "what", label: "What it is", content: <WhatTab /> },
    { id: "here", label: "How it's wired here", content: <HereTab /> },
    { id: "flow", label: "Index & search", content: <FlowTab /> },
    { id: "try", label: "Try it", content: <TryTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Vector Search & RAG (Weaviate)"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(660px, 100vw)"
    />
  );
}
