import { createDocumentExtractor } from './documentExtractor';

describe('document extractor', () => {
  it('posts bytes to Tika and normalizes rmeta output', async () => {
    const post = jest.fn().mockResolvedValue({ data: [{ 'X-TIKA:content': 'Hello\nworld', 'Content-Type': 'application/pdf', title: 'Guide', Author: 'Ada' }] });
    const extractor = createDocumentExtractor({ baseUrl: 'http://tika:9998', post });
    await expect(extractor.extract(Buffer.from('pdf'), 'guide.pdf')).resolves.toMatchObject({
      text: 'Hello\nworld', mediaType: 'application/pdf', title: 'Guide', author: 'Ada',
    });
    expect(post).toHaveBeenCalledWith('http://tika:9998/rmeta/text', expect.any(Buffer), expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }));
  });

  it('rejects an empty extraction', async () => {
    const extractor = createDocumentExtractor({ baseUrl: 'http://tika:9998', post: jest.fn().mockResolvedValue({ data: [{}] }) });
    await expect(extractor.extract(Buffer.from('empty'), 'empty.pdf')).rejects.toThrow(/no text/i);
  });
});
