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

/**
 * List the codebases currently indexed on the server (from the vector store),
 * so the UI can show them regardless of per-browser localStorage.
 * @returns {Promise<Array<{id: string, name: string, chunks: number}>>}
 */
export async function listCodebases() {
  const response = await fetch(`${API_BASE}/codebases`, {
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error || error.message || `Failed to list codebases (status ${response.status})`
    );
  }

  const data = await response.json();
  return data.codebases || [];
}
