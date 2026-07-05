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
import { Store, StoredChunk } from './weaviateStore';

const WINDOW_LINES = 40;
const OVERLAP_LINES = 8;

export interface ServerDeps {
  embedder: Embedder;
  store: Store;
}

interface IndexFile {
  path: string;
  content: string; // base64
}

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

  return app;
}
