async function request(path, options = {}) {
  const response = await fetch(`/api/document-rag${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `Document RAG request failed (${response.status})`);
  return body;
}

export async function searchDocuments(query, collectionId = 'learning-hub', limit = 8) {
  const body = await request('/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, collection_id: collectionId, limit }) });
  return body.results || [];
}

export async function answerDocuments(query, collectionId = 'learning-hub') {
  return request('/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, collection_id: collectionId }) });
}

export async function listDocuments(collectionId = 'learning-hub') {
  const body = await request(`/documents?collection_id=${encodeURIComponent(collectionId)}`);
  return body.documents || [];
}

export async function indexDocuments(files, collectionId = 'learning-hub') {
  const form = new FormData();
  form.append('collection_id', collectionId);
  files.forEach((file) => form.append('file', file, file.name));
  const job = await request('/index', { method: 'POST', body: form });
  if (!job.job_id) return job;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const status = await request(`/jobs/${encodeURIComponent(job.job_id)}`);
    if (status.status === 'complete') return status;
    if (status.status === 'failed') throw new Error(status.error || 'Document indexing failed');
  }
  throw new Error('Document indexing timed out');
}

export async function deleteDocument(documentId, collectionId = 'learning-hub') {
  return request(`/documents/${encodeURIComponent(documentId)}?collection_id=${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
}
