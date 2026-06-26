// tests/ollamaLlmService.test.js
//
// Unit tests for ollamaLlmService — all network calls are intercepted via
// jest.spyOn(global, 'fetch') so no daemon is required.

const { callOllama } = require('../services/ollamaLlmService');

function makeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_MODEL;
  delete process.env.OLLAMA_TIMEOUT_MS;
});

describe('callOllama', () => {
  test('returns assistant reply text on success', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      makeResponse({ choices: [{ message: { content: 'Hello world' } }] })
    );
    const result = await callOllama([{ role: 'user', content: 'hi' }]);
    expect(result).toBe('Hello world');
  });

  test('strips <think>…</think> chain-of-thought wrapper', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      makeResponse({ choices: [{ message: { content: '<think>reasoning here</think>Final answer' } }] })
    );
    const result = await callOllama([{ role: 'user', content: 'q' }]);
    expect(result).toBe('Final answer');
  });

  test('strips multi-line <think> blocks', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      makeResponse({ choices: [{ message: { content: '<think>\nline1\nline2\n</think>  answer  ' } }] })
    );
    const result = await callOllama([{ role: 'user', content: 'q' }]);
    expect(result).toBe('answer');
  });

  test('maps human role to user', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'human', content: 'test' }]);
    expect(capturedBody.messages[0].role).toBe('user');
  });

  test('uses OLLAMA_MODEL env var when set', async () => {
    process.env.OLLAMA_MODEL = 'llama3.1:8b';
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }]);
    expect(capturedBody.model).toBe('llama3.1:8b');
  });

  test('overrideModel param takes precedence over OLLAMA_MODEL env var', async () => {
    process.env.OLLAMA_MODEL = 'llama3.1:8b';
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }], 'qwen3:8b');
    expect(capturedBody.model).toBe('qwen3:8b');
  });

  test('overrideModel param takes precedence over default model', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }], 'gemma4:latest');
    expect(capturedBody.model).toBe('gemma4:latest');
  });

  test('ignores blank overrideModel and uses env/default', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }], '   ');
    expect(capturedBody.model).toBe('qwen2.5:3b');
  });

  test('uses default model qwen2.5:3b when OLLAMA_MODEL not set', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }]);
    expect(capturedBody.model).toBe('qwen2.5:3b');
  });

  test('uses OLLAMA_BASE_URL env var when set', async () => {
    process.env.OLLAMA_BASE_URL = 'http://remote-ollama:11434';
    let capturedUrl;
    jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      capturedUrl = url;
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }]);
    expect(capturedUrl).toContain('http://remote-ollama:11434');
  });

  test('throws when server returns non-2xx', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(makeResponse({ error: 'model not found' }, 404));
    await expect(callOllama([{ role: 'user', content: 'q' }]))
      .rejects.toThrow('Ollama chat/completions failed: 404');
  });

  test('throws on empty completion', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      makeResponse({ choices: [{ message: { content: '   ' } }] })
    );
    await expect(callOllama([{ role: 'user', content: 'q' }]))
      .rejects.toThrow('Ollama returned an empty completion');
  });

  test('throws when messages array is empty', async () => {
    await expect(callOllama([])).rejects.toThrow('No messages provided to Ollama');
  });

  test('throws when messages is null', async () => {
    await expect(callOllama(null)).rejects.toThrow('No messages provided to Ollama');
  });

  test('aborts and throws on timeout (OLLAMA_TIMEOUT_MS=1)', async () => {
    process.env.OLLAMA_TIMEOUT_MS = '1';
    jest.spyOn(global, 'fetch').mockImplementation(
      (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted.');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );
    await expect(callOllama([{ role: 'user', content: 'q' }]))
      .rejects.toThrow(/aborted/i);
  }, 5000);

  test('sends think:false in request body', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }]);
    expect(capturedBody.think).toBe(false);
  });

  test('sends stream:false in request body', async () => {
    let capturedBody;
    jest.spyOn(global, 'fetch').mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await callOllama([{ role: 'user', content: 'q' }]);
    expect(capturedBody.stream).toBe(false);
  });
});
