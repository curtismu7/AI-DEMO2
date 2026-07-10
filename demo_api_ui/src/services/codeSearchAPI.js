const API_BASE = '/api/code-search';

/**
 * Throw a normalized Error when the BFF response is not OK: prefer the JSON
 * body's error/message fields, fall back to a label + HTTP status.
 * @param {Response} response
 * @param {string} label - e.g. 'Upload failed'
 */
async function throwIfNotOk(response, label) {
  if (response.ok) return;
  const error = await response.json().catch(() => ({}));
  throw new Error(
    error.error || error.message || `${label} (status ${response.status})`
  );
}

/**
 * @param {File} file - ZIP file to index
 * @param {string} codebaseName - Human-readable name for the codebase
 * @param {string} [chunkStrategy='simple'] - Chunking strategy (simple or ast_aware)
 * @returns {Promise<{codebase_id: string, files_indexed: number, chunks_created: number}>}
 */
export async function indexCodebase(file, codebaseName, chunkStrategy = 'simple') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('codebase_name', codebaseName);
  formData.append('chunk_strategy', chunkStrategy);

  const response = await fetch(`${API_BASE}/index`, {
    method: 'POST',
    body: formData,
  });

  await throwIfNotOk(response, 'Upload failed');
  return response.json();
}

/**
 * @param {string} query - Search query
 * @param {string} codebaseId - ID of the codebase to search
 * @param {number} [limit=10] - Maximum number of results
 * @param {string} [fileFilter] - Optional glob pattern to filter files
 * @returns {Promise<Array>}
 */
export async function searchCode(query, codebaseId, limit = 10, fileFilter = undefined) {
  const body = {
    query,
    codebase_id: codebaseId,
    limit,
  };

  if (fileFilter) {
    body.file_filter = fileFilter;
  }

  const response = await fetch(`${API_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  await throwIfNotOk(response, 'Search failed');
  const data = await response.json();
  return data.results || [];
}

/**
 * List the codebases currently indexed on the server (from the vector store),
 * so the UI can show them regardless of per-browser localStorage.
 * @returns {Promise<Array<{id: string, name: string, chunks: number}>>}
 */
export async function listCodebases() {
  const response = await fetch(`${API_BASE}/codebases`);

  await throwIfNotOk(response, 'Failed to list codebases');
  const data = await response.json();
  return data.codebases || [];
}

const FOLDER_ALLOW_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'json', 'md', 'css', 'scss', 'yml', 'yaml', 'sh',
  'go', 'java', 'rb', 'rs', 'txt', 'html',
]);
const FOLDER_IGNORE_RE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/i;
// Exported so the uploader's skip warning can state the actual limits.
export const FOLDER_MAX_FILE_BYTES = 256 * 1024;
export const FOLDER_MAX_FILES = 2000;

/** Pure: split a picked folder's FileList into accepted code files + skipped count. */
export function filterFolderFiles(fileList) {
  const accepted = [];
  let skipped = 0;
  for (const f of Array.from(fileList)) {
    const rel = f.webkitRelativePath || f.name;
    const ext = (rel.split('.').pop() || '').toLowerCase();
    if (
      accepted.length >= FOLDER_MAX_FILES
      || FOLDER_IGNORE_RE.test(rel)
      || !FOLDER_ALLOW_EXT.has(ext)
      || f.size > FOLDER_MAX_FILE_BYTES
    ) {
      skipped++;
      continue;
    }
    accepted.push(f);
  }
  return { accepted, skipped };
}

/** Upload picked folder files through the existing multi-file /index route. */
export async function indexFolderFiles(files, codebaseName) {
  const formData = new FormData();
  formData.append('codebase_name', codebaseName);
  for (const f of files) {
    formData.append('file', f, f.webkitRelativePath || f.name);
  }
  const response = await fetch(`${API_BASE}/index`, { method: 'POST', body: formData });
  await throwIfNotOk(response, 'Index failed');
  return response.json();
}
