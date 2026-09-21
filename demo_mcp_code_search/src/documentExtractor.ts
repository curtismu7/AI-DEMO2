import axios from 'axios';

export interface ExtractedDocument {
  text: string;
  mediaType?: string;
  title?: string;
  author?: string;
  pageCount?: number;
  metadata: Record<string, unknown>;
}

export interface DocumentExtractor {
  extract(bytes: Buffer, filename?: string): Promise<ExtractedDocument>;
}

interface ExtractorOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxExtractedChars?: number;
  post?: (url: string, data: Buffer, config: Record<string, unknown>) => Promise<{ data: unknown }>;
}

export function createDocumentExtractor(options: ExtractorOptions): DocumentExtractor {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const post = options.post ?? ((url, data, config) => axios.put(url, data, config));
  return {
    async extract(bytes, filename = 'document') {
      if (options.maxBytes && bytes.length > options.maxBytes) throw new Error(`document exceeds the ${options.maxBytes}-byte limit`);
      const response = await post(`${baseUrl}/rmeta/text`, bytes, {
        timeout: options.timeoutMs ?? 30_000,
        headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream', 'X-Tika-OCRskipOcr': 'true' },
        params: { resourceName: filename },
      });
      const rows = Array.isArray(response.data) ? response.data : [response.data];
      const metadata = (rows[0] && typeof rows[0] === 'object' ? rows[0] : {}) as Record<string, unknown>;
      const text = String(metadata['X-TIKA:content'] ?? metadata.content ?? '').trim();
      if (!text) throw new Error(`Tika extracted no text from ${filename}`);
      if (options.maxExtractedChars && text.length > options.maxExtractedChars) throw new Error(`Tika output exceeds the ${options.maxExtractedChars}-character limit`);
      const pageRaw = metadata['xmpTPg:NPages'] ?? metadata['Page-Count'];
      const pageCount = pageRaw === undefined ? undefined : Number(pageRaw);
      return {
        text,
        mediaType: String(metadata['Content-Type'] ?? metadata['Content-Type-Override'] ?? ''),
        title: String(metadata.title ?? metadata['dc:title'] ?? ''),
        author: String(metadata.Author ?? metadata['meta:author'] ?? ''),
        pageCount: Number.isFinite(pageCount) ? pageCount : undefined,
        metadata,
      };
    },
  };
}
