// Per-provider default model IDs. Own module so agentRunHandler can read it
// (to tag spans with the model) without importing reasoningGraph's heavy graph.
export const DEFAULT_MODELS: Record<string, string> = {
  helix: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5-5',
  // llama-server serves whatever model it was launched with; this is only a
  // last-resort fallback when /v1/models can't be reached and no env override.
  llamacpp: 'local-model',
  mlx: 'local-model',
  google: 'gemini-2.0-flash',
  groq: 'openai/gpt-oss-20b',
};
