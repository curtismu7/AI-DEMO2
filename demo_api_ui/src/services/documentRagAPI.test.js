import { describe, expect, it, vi } from 'vitest';
import { searchDocuments } from './documentRagAPI';

describe('documentRagAPI', () => {
  it('returns collection-scoped document citations', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [{ document_id: 'd1', title: 'Guide', section: 'Intro', text: 'Grounded text' }] }) });
    await expect(searchDocuments('OAuth', 'learning-hub')).resolves.toEqual([{ document_id: 'd1', title: 'Guide', section: 'Intro', text: 'Grounded text' }]);
    expect(global.fetch).toHaveBeenCalledWith('/api/document-rag/search', expect.objectContaining({ method: 'POST' }));
  });
});
