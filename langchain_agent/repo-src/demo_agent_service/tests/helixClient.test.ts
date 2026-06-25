// banking_agent_service/tests/helixClient.test.ts
import { callHelix } from '../src/helixClient';

const CFG = {
  helix_base_url: 'https://helix.example.com',
  helix_api_key: 'k',
  helix_environment_id: 'env1',
  helix_agent_id: 'agentA',
  helix_prompt_field_id: 'promptField',
};

describe('callHelix — 3-step Helix Conversation flow', () => {
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  test('throws if config incomplete', async () => {
    await expect(callHelix({}, [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/Helix config incomplete/);
  });

  test('create → post → immediate complete value returns text', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1', class: 'complete', value: 'hello world' }) });
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('hello world');
    const createBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(createBody).toEqual({ agent: { version: 'published' } });
    const postBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(postBody.content.promptField).toBe('hi');
  });

  test('post returns no value → polls until agent message', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'mq' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([]) })
      .mockResolvedValueOnce({ ok: true, json: async () => ([{ sender_role: 'agent', message_id: 'ma', class: 'complete', value: 'polled answer' }]) });
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('polled answer');
  });

  test('extractValue unwraps JSON {response} when present', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1', home_channel: 'ch1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1', class: 'complete', value: JSON.stringify({ response: 'unwrapped' }) }) });
    const out = await callHelix(CFG, [{ role: 'user', content: 'hi' }]);
    expect(out).toBe('unwrapped');
  });

  test('create failure throws', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(callHelix(CFG, [{ role: 'user', content: 'hi' }]))
      .rejects.toThrow(/Helix createConversation failed: 500/);
  });
});
