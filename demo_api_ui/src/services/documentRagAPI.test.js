import { describe, expect, it, vi } from 'vitest';
import { answerDocuments, searchDocuments } from './documentRagAPI';

describe('documentRagAPI', () => {
  it('returns collection-scoped document citations', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ document_id: 'd1', title: 'Guide', section: 'Intro', text: 'Grounded text' }] }) });
    await expect(searchDocuments('OAuth', 'learning-hub')).resolves.toEqual([{ document_id: 'd1', title: 'Guide', section: 'Intro', text: 'Grounded text' }]);
    expect(global.fetch).toHaveBeenCalledWith('/api/document-rag/search', expect.objectContaining({ method: 'POST' }));
  });

  it('returns an LLM answer with document citations', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'Use [1].', citations: [{ index: 1, title: 'Guide' }] }) });
    await expect(answerDocuments('How does OAuth work?')).resolves.toMatchObject({ answer: 'Use [1].' });
    expect(global.fetch).toHaveBeenCalledWith('/api/document-rag/answer', expect.objectContaining({ method: 'POST' }));
  });
});
