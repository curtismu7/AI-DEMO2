// banking_agent_service/src/reasonContract.ts
// BFF ↔ :3006 reasoning protocol (no user token crosses this boundary).

export interface ReasonToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ReasonMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
}

export interface ReasonRequest {
  messages: ReasonMessage[];
  tools: ReasonToolSchema[];
  provider: 'helix' | 'anthropic' | 'anthropic-lmstudio' | 'lmstudio' | 'llamacpp' | 'mlx'; // already resolved by the BFF
  model?: string;
  // Vertical system prompt injected by the BFF from manifest.agent.systemPromptFlavor
  systemPrompt?: string;
  // Helix connection config (BFF-owned; passed through, never a token)
  helixConfig?: Record<string, string | undefined>;
  // Anthropic — API key passed from BFF env; never a user token
  anthropicApiKey?: string;
}

export interface ReasoningState {
  phase: 'planning' | 'tool_selection' | 'tool_execution' | 'synthesis';
  toolOptions?: Array<{ toolName: string; description?: string; confidence?: number }>;
  contextTokens?: { inputTokens: number; outputTokens?: number; estimatedTotal: number; pctWindow: number };
}

export type ReasonResponse =
  | { type: 'tool_calls'; calls: Array<{ id: string; name: string; args: Record<string, unknown> }>; messages: ReasonMessage[]; reasoning?: ReasoningState }
  | { type: 'final'; answer: string; messages: ReasonMessage[]; reasoningUnavailable?: boolean; inputTokens?: number; outputTokens?: number; reasoning?: ReasoningState };
