# Learning Hub Document RAG with Apache Tika

Status: proposed for later development  
Target: Docker and Ping SE Kubernetes deployments  
Primary demo surface: Learning Hub  
Related systems: `demo_mcp_code_search`, Weaviate, embeddings, BFF, Learning Hub

## 1. Objective

Add a small document-oriented RAG demo that answers questions from Learning Hub
content and shows citations to the exact source document and section.

Use Apache Tika as the format-normalization layer. Tika extracts text and
metadata from documents; the existing embedding server and Weaviate remain the
retrieval layer. The LLM receives only the best retrieved chunks and their
source metadata.

The first version should demonstrate the complete pipeline without becoming a
general document-management product:

1. Select or upload a document set.
2. Extract text and metadata with Tika.
3. Split the extracted text into citation-friendly chunks.
4. Embed and store the chunks in Weaviate.
5. Ask a question from the Learning Hub.
6. Return a grounded answer with clickable source citations.

## 2. Why the Learning Hub is the right first corpus

The repository already contains curated educational material and an exporter:

- `demo_api_ui/src/components/LearningHub.tsx` is the interactive catalog.
- `learning/` contains exported Learning Hub pages.
- `scripts/export-learning-hub.mjs` and
  `scripts/learning-hub-manifest.json` provide a repeatable source pipeline.
- The existing RAG profile already supplies Weaviate, an embedding server,
  `demo-mcp-code-search`, and `llamaindex-agent`.

This gives the demo a small, understandable corpus with known answers and useful
citations. It also avoids introducing a new content-authoring workflow during
the MVP.

## 3. Key architectural decision

Run Tika as a private service and extend the current code-search service with a
separate document ingestion/retrieval module.

```text
Learning Hub seed files or admin upload
                 |
                 v
        BFF document endpoints
                 |
                 v
       demo-mcp-code-search
          |             |
          v             v
   Apache Tika      embeddings
   text/metadata       vectors
          \             /
           v           v
        Weaviate DocumentChunk
                 |
                 v
       protected retrieval tool
                 |
                 v
       LLM answer + citations
                 |
                 v
          Learning Hub UI
```

Do not put Java or Tika libraries into the Node service. Use the standard Tika
Server REST application as its own container. Apache documents Tika Server as a
Jetty-hosted REST application containing the standard parsers. This keeps the
existing Node image small and isolates parser dependencies and failures.

Do not reuse the existing `CodeChunk` schema for documents. Add a
`DocumentChunk` class so code-specific line ranges, filters, and retrieval
behavior remain stable.

## 4. MVP scope

### Included

- Seed the exported Learning Hub HTML pages from `learning/`.
- Accept `.html`, `.md`, `.txt`, `.pdf`, and `.docx` documents.
- Extract normalized text, detected media type, title, author, and page count
  when available.
- Store document and chunk identifiers, headings, page hints, content hashes,
  and source URLs.
- Search only within one selected collection, initially `learning-hub`.
- Produce answers with document title plus section/page citations.
- Display ingestion status, indexed document count, last indexed time, and
  extraction failures.
- Support deterministic re-indexing and removal of stale chunks.

### Deferred

- OCR and scanned-image ingestion.
- Email archives, nested attachments, and compressed archives.
- Connectors to SharePoint, Google Drive, S3, or arbitrary URLs.
- Per-user private document libraries.
- Cross-encoder reranking.
- Automatic knowledge-graph construction.
- Editable document authoring inside the demo.

OCR should be a separate opt-in phase because it adds native dependencies,
resource cost, longer processing times, and a larger attack surface.

## 5. Components and proposed changes

### 5.1 Apache Tika service

Add a `tika` service to the existing `rag` profile:

- Pin an explicit Apache Tika Server image version; do not use `latest`.
- Expose the service only on the Compose/Kubernetes network, for example
  `http://tika:9998`.
- Do not publish a host port in the default configuration.
- Set CPU, memory, request-size, and parse-time limits.
- Run as a non-root user with a read-only filesystem where the image permits.
- Disable outbound network access at the Kubernetes policy layer.
- Add a health check that proves the server is ready without parsing a large
  document.

Proposed configuration:

```text
TIKA_URL=http://tika:9998
DOCUMENT_MAX_BYTES=10485760
DOCUMENT_PARSE_TIMEOUT_MS=30000
DOCUMENT_MAX_EXTRACTED_CHARS=2000000
DOCUMENT_ALLOWED_TYPES=text/plain,text/markdown,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document
```

### 5.2 Document extraction client

Add `demo_mcp_code_search/src/documentExtractor.ts`:

- Stream file bytes to Tika rather than base64-encoding them in JSON.
- Ask Tika for structured metadata and normalized text.
- Preserve the detected media type instead of trusting the filename extension.
- Normalize newlines and Unicode, but retain heading and page boundaries when
  Tika exposes them.
- Reject empty extraction results with an actionable error.
- Enforce timeout and extracted-text limits in the caller, even if Tika is also
  configured with limits.
- Return a typed extraction result:

```ts
interface ExtractedDocument {
  text: string;
  mediaType: string;
  title?: string;
  author?: string;
  pageCount?: number;
  metadata: Record<string, string | string[]>;
}
```

### 5.3 Document chunking

Add `demo_mcp_code_search/src/documentChunker.ts`; do not force documents
through the current 40-line source-code chunker.

MVP chunking rules:

1. Split HTML/Markdown on headings and paragraphs.
2. Split PDF/DOCX normalized text on page and paragraph boundaries where
   available.
3. Target approximately 500 to 800 tokens per chunk with 80 to 120 tokens of
   overlap.
4. Never merge content across different documents.
5. Carry the nearest heading and page number into every chunk.
6. Drop blank boilerplate chunks and exact duplicates.
7. Compute a stable chunk ID from collection ID, document hash, section path,
   and chunk ordinal.

Token-aware chunking is preferable to character-only splitting because the
embedding service has a fixed context limit. Continue enforcing the existing
embedder-side truncation as a final safety net.

### 5.4 Weaviate schema

Add a separate `DocumentChunk` class with bring-your-own vectors:

| Property | Purpose |
|---|---|
| `collection_id` | Corpus boundary, initially `learning-hub` |
| `document_id` | Stable source identity |
| `document_hash` | Idempotent re-index detection |
| `title` | Display title |
| `source_path` | Repository-relative source path |
| `source_url` | Clickable Learning Hub route or approved external URL |
| `media_type` | Tika-detected type |
| `section` | Nearest heading or section path |
| `page_number` | Optional human-readable page citation |
| `chunk_index` | Ordering within the document |
| `content` | Extracted chunk text |
| `indexed_at` | Operational visibility |

Add store methods separate from the code methods:

- `ensureDocumentSchema()`
- `replaceDocumentChunks()`
- `deleteDocument()`
- `listDocuments()`
- `searchDocuments()`

`replaceDocumentChunks()` must remove old chunks for the same `document_id`
only after the new extraction and embeddings succeed. This prevents a failed
re-index from erasing a working corpus.

### 5.5 Service APIs

Add internal REST endpoints to `demo-mcp-code-search`:

```text
POST   /documents/index
POST   /documents/search
GET    /documents?collection_id=learning-hub
DELETE /documents/:documentId
GET    /documents/jobs/:jobId
```

The indexing endpoint should accept `multipart/form-data`. For the Learning Hub
seed job, an internal script may stream repository files directly.

Indexing should return `202 Accepted` with a job ID. Parsing and embedding can
take longer than a normal request timeout, and the UI needs honest progress and
per-file failures.

Suggested job states:

```text
queued -> extracting -> chunking -> embedding -> storing -> complete
                                                \-> failed
```

For the MVP, jobs may be held in process memory if the seed set is small. Before
production use, persist them in LMDB or another existing durable store.

### 5.6 BFF boundary

Add BFF routes, rather than calling Tika or the RAG service directly from the
browser:

```text
POST /api/document-rag/index
POST /api/document-rag/search
GET  /api/document-rag/documents
GET  /api/document-rag/jobs/:jobId
```

Requirements:

- Browser uploads terminate at the BFF.
- Admin authorization is required for index, delete, and re-index operations.
- Search may follow the existing Protected RAG use-case authorization rule.
- Use a narrow internal service credential from the existing BFF secret
  boundary.
- Never log document bytes, full extracted content, access tokens, or secrets.
- Enforce upload size and media-type policy before forwarding to Tika.
- Return structured errors that distinguish unsupported type, parse failure,
  dependency unavailable, and policy denial.

### 5.7 Learning Hub UI

Add a `Document Q&A` action or panel to the Learning Hub rather than creating a
new top-level product area.

Recommended first screen:

- Collection selector, initially fixed to `Learning Hub`.
- Question input and Ask button.
- Answer with numbered citations.
- Retrieved-source drawer showing title, section/page, relevance, and excerpt.
- Corpus status: document count and last indexed timestamp.
- Admin-only `Re-index Learning Hub` and `Upload documents` actions.
- Clear empty, indexing, unavailable, denied, and no-answer states.

The answer payload should make citations data, not prose parsing:

```json
{
  "answer": "...",
  "citations": [
    {
      "documentId": "token-exchange-rfc-8693",
      "title": "Token Exchange (RFC 8693)",
      "section": "Delegation claims",
      "page": null,
      "sourceUrl": "/learning/token-exchange-rfc-8693.html",
      "excerpt": "...",
      "relevance": 0.87
    }
  ]
}
```

## 6. Seed pipeline

Add `scripts/index-learning-hub-documents.mjs`:

1. Read `scripts/learning-hub-manifest.json` as the source of truth.
2. Resolve the corresponding exported files under `learning/`.
3. Compute SHA-256 for each file.
4. Compare hashes with the indexed document inventory.
5. Submit only new or changed documents.
6. Remove stale indexed documents only with an explicit `--prune` flag.
7. Print a deterministic summary and exit non-zero on any failed document.

Suggested commands:

```text
npm run rag:index:learning
npm run rag:index:learning -- --dry-run
npm run rag:index:learning -- --prune
```

Do not make every frontend build re-index the corpus. Run indexing explicitly
after the RAG stack is healthy, and optionally from the existing RAG deployment
script when `RAG_SEED_LEARNING_HUB=1`.

## 7. Retrieval and answer generation

Keep retrieval behavior simple and inspectable:

1. Embed the question.
2. Search `DocumentChunk` with a mandatory `collection_id` filter.
3. Retrieve the top 8 chunks.
4. Apply a configurable minimum relevance threshold.
5. Deduplicate adjacent chunks from the same document.
6. Send at most 4 to 6 chunks to the LLM.
7. Instruct the model to answer only from supplied context and say when the
   corpus does not contain the answer.
8. Return citations from retrieved metadata, independent of model-generated
   citation syntax.

The UI should expose the retrieved chunks so the demo can explain why a result
was produced. This is more valuable than hiding retrieval behind a polished
answer.

## 8. Security and abuse controls

Document parsing handles attacker-controlled binary data and must be treated as
a separate trust boundary.

- Pin Tika and monitor Apache security advisories.
- Keep Tika internal; no public ingress or browser access.
- Disable remote URL ingestion in the MVP to avoid SSRF.
- Do not index archives or embedded attachments initially.
- Reject encrypted/password-protected documents in the MVP.
- Enforce compressed size, extracted size, parse time, and page-count limits.
- Use temporary storage with quotas and immediate cleanup.
- Scan uploads before parsing if the demo later accepts untrusted files.
- Strip active content and never serve uploaded originals inline.
- Treat extracted text as untrusted prompt content. Delimit it clearly and tell
  the model that document instructions cannot override system/tool policy.
- Enforce collection-level authorization before retrieval, not after the LLM
  answers.
- Preserve document ACL metadata in the schema even if the MVP has only one
  public-to-authenticated collection; this avoids a later unsafe retrofit.

## 9. Observability

Capture the following without recording document contents:

- File name, detected media type, byte size, extraction duration, chunk count,
  embedding duration, and final status.
- Tika timeout/error class.
- Search latency, candidate count, selected chunk count, and relevance range.
- Collection ID and document IDs used in each answer.
- Policy decision and authenticated subject identifier using existing redaction
  conventions.

Add health detail for Tika, embeddings, and Weaviate to the RAG status response.
A green service process is not sufficient if extraction or embeddings are not
ready.

## 10. Testing strategy

### Unit tests

- Tika response parsing and metadata normalization.
- Timeout, unsupported-type, empty-text, and oversized-extraction failures.
- Heading/page-aware chunk boundaries and overlap.
- Stable document and chunk IDs.
- Idempotent re-index and safe replacement behavior.
- Collection filter is mandatory on every search.
- Citation mapping is independent of model prose.

### Service tests

- Index small `.txt`, `.html`, `.pdf`, and `.docx` fixtures.
- Search returns the expected source and section.
- A failed re-index leaves the previous document searchable.
- Unsupported and password-protected fixtures fail safely.
- Tika unavailable returns `503`, not an ambiguous `500`.

### BFF tests

- Upload/re-index/delete require admin authorization.
- Search follows the Protected RAG authorization requirement.
- Upload limits are enforced before forwarding.
- Internal credentials and extracted contents never appear in responses/logs.

### UI tests

- Ask, loading, answer, citation, no-answer, denial, and unavailable states.
- Citation click opens the correct Learning Hub source.
- Admin ingestion controls are absent for non-admin users.
- Re-index progress and partial failures are visible.

### End-to-end acceptance corpus

Seed three documents with deliberately overlapping terminology and maintain a
small question set with expected document IDs. Include:

- A direct fact question.
- A comparison requiring two sources.
- A question whose answer is absent.
- A prompt-injection sentence inside a fixture; the answer must ignore it.
- A question asked under a subject without collection access.

## 11. Delivery phases

### Phase 0: spike

- Start a pinned Tika Server container locally.
- Extract one exported Learning Hub HTML page, one PDF, and one DOCX.
- Record extraction quality, latency, metadata, and container memory.
- Confirm the chosen Tika endpoint and output format.

Exit criterion: all three fixtures yield useful normalized text and stable
metadata without changing the existing RAG service.

### Phase 1: ingestion foundation

- Add Tika to Docker and Kubernetes RAG profiles.
- Implement extraction client, document chunker, `DocumentChunk` schema, and
  internal document endpoints.
- Add fixtures and focused service tests.

Exit criterion: deterministic indexing and search work through service APIs.

### Phase 2: Learning Hub seed corpus

- Implement the manifest-driven seed script.
- Index exported Learning Hub content under `learning-hub`.
- Add inventory and re-index status endpoints.

Exit criterion: a fresh RAG deployment can seed and verify the corpus with one
command.

### Phase 3: protected Q&A

- Add BFF routes and authorization.
- Add grounded answer generation with structured citations.
- Add the Learning Hub Document Q&A panel.

Exit criterion: an authenticated demo user can ask a question, inspect retrieved
evidence, and open the cited Learning Hub source.

### Phase 4: admin upload

- Add upload/re-index/delete controls.
- Add async job progress and partial-failure reporting.
- Harden file limits and temporary-storage cleanup.

Exit criterion: an admin can add a supported document without shell access and
the new content becomes searchable without restarting services.

### Phase 5: deployment hardening

- Add Kubernetes resources, network policy, resource limits, and health checks.
- Extend Docker/Kubernetes RAG startup and smoke scripts.
- Add a deterministic live smoke query tied to the seeded corpus.

Exit criterion: Docker and Ping SE deployments report extraction, indexing,
retrieval, citation, and authorization health separately.

## 12. Definition of done

- Existing code-search behavior and the `CodeChunk` schema remain unchanged.
- Tika has no public ingress and cannot fetch arbitrary URLs.
- The Learning Hub corpus can be seeded idempotently from the manifest.
- At least HTML, Markdown/text, PDF, and DOCX are covered by real fixtures.
- Answers include structured, clickable citations with relevant excerpts.
- Absent answers are reported honestly rather than synthesized.
- Index administration is admin-only; retrieval is collection-authorized.
- Docker and Kubernetes RAG profiles include pinned, health-checked Tika.
- Focused service, BFF, UI, security, and deployment smoke tests pass.
- Operational documentation includes re-index, prune, rollback, and recovery
  procedures.

## 13. Recommended first development slice

Implement only the following in the first PR:

1. Tika service in the Docker `rag` profile.
2. `documentExtractor.ts` with HTML, PDF, and DOCX fixtures.
3. `documentChunker.ts` with heading-aware chunks.
4. A separate `DocumentChunk` Weaviate schema.
5. Internal `/documents/index` and `/documents/search` endpoints.
6. A CLI seed of five Learning Hub pages.

Do not build the upload UI or LLM answer synthesis in the first PR. Verify the
extraction, chunk metadata, retrieval quality, and citation fidelity before
adding another presentation layer.

## 14. Open decisions for implementation kickoff

- Whether the existing `llamaindex-agent` should generate document answers or
  the BFF should call the shared LLM proxy directly after retrieval.
- Whether Learning Hub citations should target exported `learning/*.html` files
  or open the corresponding interactive education panel.
- Whether the first demo collection is readable by every authenticated user or
  protected by the current Protected RAG PingOne Authorize policy.
- The exact Tika Server image/version after checking current Apache releases and
  security advisories at implementation time.
- Whether job state may be ephemeral for the demo or must use LMDB immediately.

Recommended defaults: use the existing LlamaIndex agent, link to exported
Learning Hub pages, reuse the Protected RAG authorization policy, pin the latest
supported Tika 3.x patch at implementation time, and use ephemeral jobs for the
seed-only MVP.

## 15. References

- Inspiration: [Why are more and more people using Apache Tika?](https://medium.com/@umeshcapg/why-are-more-and-more-people-using-apache-tika-1aec567dcfe7). The page was blocked by Cloudflare during plan authoring, so no detailed claims from it are relied upon here.
- [Apache Tika: Getting Started](https://tika.apache.org/3.3.2/gettingstarted.html) documents the standard parser package, command-line extraction, and Tika Server REST application.
- Existing repository implementation: `demo_mcp_code_search/src/server.ts`,
  `demo_mcp_code_search/src/weaviateStore.ts`,
  `demo_mcp_code_search/src/chunker.ts`, `docker-compose.yml`,
  `k8s/72-rag-stack.yaml`, and `demo_api_ui/src/components/LearningHub.tsx`.
