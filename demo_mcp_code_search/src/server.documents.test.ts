import request from 'supertest';
import { createServer } from './server';

describe('document RAG routes', () => {
  it('extracts, chunks, embeds, and stores document bytes', async () => {
    const store: any = { insertDocumentChunks: jest.fn().mockResolvedValue(undefined), searchDocuments: jest.fn(), listDocuments: jest.fn(), ensureSchema: jest.fn(), ensureDocumentSchema: jest.fn(), insertChunks: jest.fn(), search: jest.fn(), listCodebases: jest.fn(), getCode: jest.fn() };
    const app = createServer({ embedder: { embed: jest.fn().mockResolvedValue([[0.1, 0.2]]) }, store, documentExtractor: { extract: jest.fn().mockResolvedValue({ text: '# Intro\n\nHello', metadata: {} }) } });
    const response = await request(app).post('/documents/index').send({ collection_id: 'learning-hub', documents: [{ document_id: 'd1', title: 'Guide', content: Buffer.from('bytes').toString('base64') }] });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ status: 'queued' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.insertDocumentChunks).toHaveBeenCalledWith([expect.objectContaining({ document_id: 'd1', vector: [0.1, 0.2] })]);
  });

  it('deletes a document through the store', async () => {
    const store: any = { deleteDocument: jest.fn().mockResolvedValue(undefined), listDocuments: jest.fn(), searchDocuments: jest.fn(), ensureSchema: jest.fn(), ensureDocumentSchema: jest.fn(), insertChunks: jest.fn(), search: jest.fn(), listCodebases: jest.fn(), getCode: jest.fn() };
    const app = createServer({ embedder: { embed: jest.fn() }, store });
    const response = await request(app).delete('/documents/doc-1?collection_id=learning-hub');
    expect(response.status).toBe(204);
    expect(store.deleteDocument).toHaveBeenCalledWith('learning-hub', 'doc-1');
  });
});
