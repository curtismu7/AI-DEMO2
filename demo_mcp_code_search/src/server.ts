/**
 * HTTP server for the code-search service.
 *
 * Despite the historical "MCP" name, the BFF (`mcpCodeSearchClient.js`) calls
 * this over plain REST, so this is a small express app. Dependencies (embedder,
 * store) are injected so the routes can be tested without live backends.
 */

import express, { Express, Request, Response } from 'express';
import { Embedder } from './embeddings';
import { chunkFile } from './chunker';
import { Store, StoredChunk, StoredDocumentChunk } from './weaviateStore';
import { DocumentExtractor } from './documentExtractor';
import { chunkDocument } from './documentChunker';
import crypto from 'node:crypto';

const WINDOW_LINES = 40;
const OVERLAP_LINES = 8;

export interface ServerDeps {
  embedder: Embedder;
  store: Store;
  documentExtractor?: DocumentExtractor;
}

interface IndexFile {
  path: string;
  content: string; // base64
}

const documentJobs = new Map<string, Record<string, unknown>>();

/** Connectivity failures surface as 503 so the BFF can report "unavailable". */
function isUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|connect|unavailable|socket hang up/i.test(
    msg
  );
}

function failure(res: Response, err: unknown, fallbackCode: string): void {
  const message = err instanceof Error ? err.message : String(err);
  if (isUnavailable(err)) {
    res.status(503).json({ error: 'service_unavailable', message });
  } else {
    res.status(500).json({ error: fallbackCode, message });
  }
}

export function createServer(deps: ServerDeps): Express {
  const app = express();
  app.use(express.json({ limit: '60mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok' });
  });

  app.get('/codebases', async (_req: Request, res: Response) => {
    try {
      const codebases = await deps.store.listCodebases();
      return res.status(200).json({ codebases });
    } catch (err) {
      return failure(res, err, 'list_failed');
    }
  });

  app.post('/index', async (req: Request, res: Response) => {
    const { codebase_id, codebase_name, files } = req.body as {
      codebase_id?: string;
      codebase_name?: string;
      files?: IndexFile[];
    };

    if (!codebase_id) {
      return res.status(400).json({ error: 'missing_codebase_id', message: 'codebase_id is required' });
    }
    if (!codebase_name) {
      return res.status(400).json({ error: 'missing_codebase_name', message: 'codebase_name is required' });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'no_files', message: 'At least one file is required' });
    }

    const errors: string[] = [];
    const pending: Array<Omit<StoredChunk, 'vector'>> = [];
    let filesIndexed = 0;

    for (const file of files) {
      try {
        const content = Buffer.from(file.content, 'base64').toString('utf8');
        const chunks = chunkFile({ path: file.path, content }, {
          windowLines: WINDOW_LINES,
          overlapLines: OVERLAP_LINES,
        });
        for (const c of chunks) {
          pending.push({
            codebase_id,
            codebase_name,
            file: c.file,
            line_start: c.line_start,
            line_end: c.line_end,
            snippet: c.snippet,
          });
        }
        filesIndexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : err}`);
      }
    }

    try {
      const vectors = await deps.embedder.embed(pending.map((c) => c.snippet));
      const stored: StoredChunk[] = pending.map((c, i) => ({ ...c, vector: vectors[i] }));
      await deps.store.insertChunks(stored);

      const body: Record<string, unknown> = {
        codebase_id,
        files_indexed: filesIndexed,
        chunks_created: stored.length,
      };
      if (errors.length > 0) body.errors = errors;
      return res.status(200).json(body);
    } catch (err) {
      return failure(res, err, 'index_failed');
    }
  });

  app.post('/search', async (req: Request, res: Response) => {
    const { query, codebase_id, limit, file_filter } = req.body as {
      query?: string;
      codebase_id?: string;
      limit?: number;
      file_filter?: string;
    };

    if (!query) {
      return res.status(400).json({ error: 'missing_query', message: 'query is required' });
    }
    if (!codebase_id) {
      return res.status(400).json({ error: 'missing_codebase_id', message: 'codebase_id is required' });
    }

    const started = Date.now();
    try {
      const [vector] = await deps.embedder.embed([query]);
      const results = await deps.store.search(vector, {
        codebaseId: codebase_id,
        limit: limit || 10,
        fileFilter: file_filter,
      });
      return res.status(200).json({ results, query_time_ms: Date.now() - started });
    } catch (err) {
      return failure(res, err, 'search_failed');
    }
  });

  app.post('/code', async (req: Request, res: Response) => {
    const { codebase_id, file, line_start, line_end } = req.body as {
      codebase_id?: string; file?: string; line_start?: number; line_end?: number;
    };
    if (!codebase_id || !file || typeof line_start !== 'number' || typeof line_end !== 'number') {
      return res.status(400).json({ error: 'missing_args', message: 'codebase_id, file, line_start, line_end are required' });
    }
    try {
      const range = await deps.store.getCode({ codebaseId: codebase_id, file, lineStart: line_start, lineEnd: line_end });
      if (!range) return res.status(404).json({ error: 'not_found', message: `No indexed content for ${file}` });
      return res.status(200).json(range);
    } catch (err) {
      return failure(res, err, 'get_code_failed');
    }
  });

  app.get('/documents', async (req: Request, res: Response) => {
    const collectionId = String(req.query.collection_id || 'learning-hub');
    try { return res.status(200).json({ documents: await deps.store.listDocuments(collectionId) }); }
    catch (err) { return failure(res, err, 'list_documents_failed'); }
  });

  app.post('/documents/index', async (req: Request, res: Response) => {
    if (!deps.documentExtractor) return res.status(503).json({ error: 'tika_unconfigured', message: 'Document extraction is not configured' });
    const { collection_id: collectionId, documents } = req.body as { collection_id?: string; documents?: Array<{ document_id: string; title: string; filename?: string; content: string; source_url?: string; source_path?: string }> };
    if (!collectionId) return res.status(400).json({ error: 'missing_collection_id', message: 'collection_id is required' });
    if (!Array.isArray(documents) || !documents.length) return res.status(400).json({ error: 'no_documents', message: 'At least one document is required' });
    const jobId = crypto.randomUUID();
    documentJobs.set(jobId, { job_id: jobId, status: 'queued', collection_id: collectionId, documents_total: documents.length, chunks_created: 0, errors: [] });
    void (async () => {
      const job = documentJobs.get(jobId)!;
      job.status = 'extracting';
      const pending: Array<Omit<StoredDocumentChunk, 'vector'>> = [];
      const errors: string[] = [];
      for (const document of documents) {
        try {
          const bytes = Buffer.from(document.content, 'base64');
          const extracted = await deps.documentExtractor!.extract(bytes, document.filename ?? document.title);
          const documentHash = crypto.createHash('sha256').update(bytes).digest('hex');
          const chunks = chunkDocument({ documentId: document.document_id, collectionId, title: document.title || extracted.title || document.filename || document.document_id, text: extracted.text, documentHash, mediaType: extracted.mediaType, sourceUrl: document.source_url, sourcePath: document.source_path });
          pending.push(...chunks.map((chunk) => ({ chunk_id: chunk.chunkId, document_id: chunk.documentId, document_hash: chunk.documentHash, media_type: chunk.mediaType, collection_id: chunk.collectionId, title: chunk.title, text: chunk.text, section: chunk.section, page_number: chunk.pageNumber, source_url: chunk.sourceUrl, source_path: chunk.sourcePath, indexed_at: new Date().toISOString() })));
        } catch (err) { errors.push(`${document.document_id}: ${err instanceof Error ? err.message : String(err)}`); }
      }
      try {
        job.status = 'embedding';
        const vectors = await deps.embedder.embed(pending.map((chunk) => chunk.text));
        job.status = 'storing';
        const stored = pending.map((chunk, index) => ({ ...chunk, vector: vectors[index] }));
        if (typeof deps.store.replaceDocumentChunks === 'function') await deps.store.replaceDocumentChunks(collectionId, stored);
        else await deps.store.insertDocumentChunks(stored);
        Object.assign(job, { status: 'complete', documents_indexed: documents.length - errors.length, chunks_created: pending.length, errors });
      } catch (err) { Object.assign(job, { status: 'failed', error: err instanceof Error ? err.message : String(err), errors }); }
    })();
    return res.status(202).json({ job_id: jobId, status: 'queued' });
  });

  app.get('/documents/jobs/:jobId', (req: Request, res: Response) => {
    const job = documentJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job_not_found' });
    return res.status(200).json(job);
  });

  app.delete('/documents/:documentId', async (req: Request, res: Response) => {
    if (typeof deps.store.deleteDocument !== 'function') return res.status(501).json({ error: 'delete_not_supported' });
    try { await deps.store.deleteDocument(String(req.query.collection_id || 'learning-hub'), req.params.documentId); return res.status(204).end(); }
    catch (err) { return failure(res, err, 'delete_document_failed'); }
  });

  app.post('/documents/search', async (req: Request, res: Response) => {
    const { query, collection_id: collectionId, limit } = req.body as { query?: string; collection_id?: string; limit?: number };
    if (!query || !collectionId) return res.status(400).json({ error: 'missing_args', message: 'query and collection_id are required' });
    try {
      const [vector] = await deps.embedder.embed([query]);
      const results = await deps.store.searchDocuments(vector, { collectionId, limit: limit || 8 });
      return res.status(200).json({ results, query });
    } catch (err) { return failure(res, err, 'search_documents_failed'); }
  });

  return app;
}
