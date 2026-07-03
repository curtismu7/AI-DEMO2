const API_BASE = '/api/code-search';

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

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || error.message || `Upload failed with status ${response.status}`
    );
  }

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

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || error.message || `Search failed with status ${response.status}`
    );
  }

  const data = await response.json();
  return data.results || [];
}

const FOLDER_ALLOW_EXT = new Set([
  'js','jsx','ts','tsx','py','json','md','css','scss','yml','yaml','sh',
  'go','java','rb','rs','txt','html',
]);
const FOLDER_IGNORE_RE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/i;
const FOLDER_MAX_FILE_BYTES = 256 * 1024;
const FOLDER_MAX_FILES = 2000;

/** Pure: split a picked folder's FileList into accepted code files + skipped count. */
export function filterFolderFiles(fileList) {
  const accepted = [];
  let skipped = 0;
  for (const f of Array.from(fileList)) {
    const rel = f.webkitRelativePath || f.name;
    const ext = (rel.split('.').pop() || '').toLowerCase();
    if (
      accepted.length >= FOLDER_MAX_FILES ||
      FOLDER_IGNORE_RE.test(rel) ||
      !FOLDER_ALLOW_EXT.has(ext) ||
      f.size > FOLDER_MAX_FILE_BYTES
    ) { skipped++; continue; }
    accepted.push(f);
  }
  return { accepted, skipped };
}

/** Upload picked folder files through the existing multi-file /index route. */
export async function indexFolderFiles(files, codebaseName) {
  const formData = new FormData();
  formData.append('codebase_name', codebaseName);
  for (const f of files) formData.append('file', f, f.webkitRelativePath || f.name);
  const response = await fetch(`${API_BASE}/index`, { method: 'POST', body: formData });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Index failed (${response.status})`);
  }
  return response.json();
}
