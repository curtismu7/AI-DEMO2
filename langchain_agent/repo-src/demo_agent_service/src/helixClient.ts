// banking_agent_service/src/helixClient.ts
// Faithful TS port of banking_api_server/services/helixLlmService.js
// callHelixAgent. 3-step Helix Conversation flow. No tokens, no persistence.
// Returns a string (Helix has no native tool-calling — see helixToolAdapter).
import type { ReasonMessage } from './reasonContract';

const HELIX_PATH = '/dpc/jas/helix/v1';

function apiBase(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin + HELIX_PATH;
  } catch {
    return baseUrl.replace(/\/$/, '').replace(/\/dpc\/.*$/, '') + HELIX_PATH;
  }
}

function extractValue(data: any): string | null {
  const items = Array.isArray(data) ? data : (Array.isArray(data?.content) ? data.content : [data]);
  const done = items.find((m: any) => m && (m.class === 'complete' || m.message_class === 'complete') && m.value != null);
  const raw = done?.value ?? null;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.response === 'string') return parsed.response;
  } catch { /* not JSON — use raw */ }
  return raw;
}

export async function callHelix(
  cfg: Record<string, string | undefined>,
  messages: ReasonMessage[],
): Promise<string> {
  const { helix_base_url, helix_api_key, helix_environment_id, helix_agent_id, helix_prompt_field_id } = cfg;
  const missing: string[] = [];
  if (!helix_base_url) missing.push('helix_base_url');
  if (!helix_api_key) missing.push('helix_api_key');
  if (!helix_environment_id) missing.push('helix_environment_id');
  if (!helix_agent_id) missing.push('helix_agent_id');
  if (!helix_prompt_field_id) missing.push('helix_prompt_field_id');
  if (missing.length) throw new Error(`Helix config incomplete: missing ${missing.join(', ')}`);
  if (!messages || messages.length === 0) throw new Error('No messages provided to Helix agent');

  const base = apiBase(helix_base_url as string);
  const apiKey = helix_api_key as string;

  const lastUser = [...messages].reverse().find((m) => m.role === 'user') || messages[messages.length - 1];
  const userText = typeof lastUser.content === 'string' ? lastUser.content : String(lastUser.content ?? '');
  const prompt = userText;

  const convRes = await fetch(
    `${base}/environments/${helix_environment_id}/agents/${helix_agent_id}/conversations`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }, body: JSON.stringify({ agent: { version: 'published' } }) },
  );
  if (!convRes.ok) {
    const errText = await convRes.text();
    throw new Error(`Helix createConversation failed: ${convRes.status} ${errText}`);
  }
  const conv: any = await convRes.json();
  if (!conv || !conv.id) throw new Error('Helix createConversation returned null');
  const conversationId = conv.id;
  const channelId = conv.home_channel;

  const msgRes = await fetch(
    `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`,
    { method: 'POST', headers: { 'Content-Type': 'application/json; async=false', 'x-api-key': apiKey }, body: JSON.stringify({ class: 'start', content: { [helix_prompt_field_id as string]: prompt } }) },
  );
  if (!msgRes.ok) {
    const errText = await msgRes.text();
    throw new Error(`Helix sendMessage failed: ${msgRes.status} ${errText}`);
  }
  const msgData: any = await msgRes.json();
  const queryMessageId = msgData?.message_id || msgData?.id;
  const immediate = extractValue(msgData);
  if (immediate != null) return immediate;

  const pollUrl = `${base}/environments/${helix_environment_id}/conversations/${conversationId}/channels/${channelId}/messages`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    const pollRes = await fetch(pollUrl, { headers: { 'x-api-key': apiKey } });
    if (!pollRes.ok) {
      const errText = await pollRes.text();
      throw new Error(`Helix poll failed: ${pollRes.status} ${errText}`);
    }
    const data: any = await pollRes.json();
    const messages_ = Array.isArray(data) ? data : [];
    const agentMsg = messages_.find((m: any) => m.sender_role === 'agent' && m.message_id !== queryMessageId && m.value != null);
    if (agentMsg) {
      const result = extractValue(agentMsg);
      if (result != null) return result;
    }
    const top = extractValue(data);
    if (top != null) return top;
  }
  throw new Error('Timed out waiting for Helix response');
}
