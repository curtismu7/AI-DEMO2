import { createEmbedder } from './embeddings';

describe('createEmbedder', () => {
  test('returns [] without calling the server for empty input', async () => {
    const post = jest.fn();
    const embedder = createEmbedder({ baseUrl: 'http://e:8080', model: 'm', post });
    expect(await embedder.embed([])).toEqual([]);
    expect(post).not.toHaveBeenCalled();
  });

  test('posts input + model to the OpenAI embeddings endpoint', async () => {
    const post = jest.fn().mockResolvedValue({
      data: { data: [{ index: 0, embedding: [0.1, 0.2] }] },
    });
    const embedder = createEmbedder({ baseUrl: 'http://e:8080/', model: 'nomic', post });

    await embedder.embed(['hello']);

    expect(post).toHaveBeenCalledWith('http://e:8080/v1/embeddings', {
      input: ['hello'],
      model: 'nomic',
    });
  });

  test('orders returned vectors by the response index, not arrival order', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        data: [
          { index: 1, embedding: [9, 9] },
          { index: 0, embedding: [1, 1] },
        ],
      },
    });
    const embedder = createEmbedder({ baseUrl: 'http://e:8080', model: 'm', post });

    const vectors = await embedder.embed(['a', 'b']);

    expect(vectors).toEqual([
      [1, 1],
      [9, 9],
    ]);
  });
});
