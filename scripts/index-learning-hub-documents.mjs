#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.env.LEARNING_HUB_ROOT || 'learning');
const endpoint = (process.env.DOCUMENT_RAG_URL || 'http://localhost:8095').replace(/\/$/, '');
const allowed = new Set(['.html', '.md', '.txt', '.pdf', '.docx']);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(full));
    else if (allowed.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

const files = await filesUnder(root);
if (!files.length) throw new Error(`No Learning Hub documents found under ${root}`);
const documents = await Promise.all(files.map(async (file) => {
  const relative = path.relative(process.cwd(), file);
  return {
    document_id: `learning-hub:${path.relative(root, file)}`,
    title: path.basename(file),
    filename: path.basename(file),
    source_path: relative,
    source_url: `/learning-hub?document=${encodeURIComponent(path.relative(root, file))}`,
    content: (await readFile(file)).toString('base64'),
  };
}));

const response = await fetch(`${endpoint}/documents/index`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ collection_id: 'learning-hub', documents }),
});
const body = await response.json().catch(() => ({}));
if (!response.ok) throw new Error(body.message || body.error || `Index request failed (${response.status})`);
console.log(JSON.stringify({ ...body, documents_submitted: documents.length }, null, 2));
