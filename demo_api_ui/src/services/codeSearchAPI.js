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
 * Ask the agent about an indexed corpus.
 * @param {string} question
 * @param {string} codebaseId
 * @param {number} [limit=8]
 */
export async function askCodeSearch(question, codebaseId, limit = 8) {
  const response = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, codebase_id: codebaseId, limit }),
  });
  await throwIfNotOk(response, 'Agent request failed');
  return response.json();
}

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

/**
 * Upload picked folder files through the existing multi-file /index route.
 * @param {File[]} files
 * @param {string} codebaseName
 * @param {string} [codebaseId] - stable id so multi-batch uploads land together
 */
export async function indexFolderFiles(files, codebaseName, codebaseId) {
  const formData = new FormData();
  formData.append('codebase_name', codebaseName);
  if (codebaseId) formData.append('codebase_id', codebaseId);
  for (const f of files) {
    formData.append('file', f, f.webkitRelativePath || f.name);
  }
  const response = await fetch(`${API_BASE}/index`, { method: 'POST', body: formData });
  await throwIfNotOk(response, 'Index failed');
  return response.json();
}

/**
 * Decide whether a picked folder should be one codebase or several pieces.
 * webkitRelativePath is "SelectedRoot/child/...". When SelectedRoot has 2+
 * child directories that contain files, treat those children as pieces
 * (e.g. picking the AI-DEMO2 repo → UI / Server / Gateway…).
 * @param {File[]} accepted
 * @returns {{ mode: 'single', name: string, files: File[] }
 *   | { mode: 'pieces', rootName: string, groups: Map<string, File[]> }}
 */
export function planFolderIndex(accepted) {
  const rootName = (accepted[0]?.webkitRelativePath || 'folder').split('/')[0];
  const childDirs = new Set();
  for (const f of accepted) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    if (parts.length >= 3) childDirs.add(parts[1]);
  }

  if (childDirs.size < 2) {
    return { mode: 'single', name: rootName, files: accepted };
  }

  const groups = new Map();
  for (const f of accepted) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    const piece = parts.length >= 3 ? parts[1] : rootName;
    if (!groups.has(piece)) groups.set(piece, []);
    groups.get(piece).push(f);
  }
  return { mode: 'pieces', rootName, groups };
}
