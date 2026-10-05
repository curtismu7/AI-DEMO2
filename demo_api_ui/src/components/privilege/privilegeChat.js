// Message shapes for the Privilege chat, shared by the Cursor page and the footprint
// skins so a change to the /chat or /llm/call reply or denial format is made once.
// Pure: no state, no network. Control flow stays with each caller.

export const LLM_POLICY_DENIED = 'llm_policy_denied';

/** A /chat reply as an assistant message. */
export function chatReplyMessage(data) {
  return {
    content: data.reply || 'Done.',
    extra: {
      available_tools: (data.tools || []).map((t) => t.name),
      suggested_tools: data.suggested_tools || [],
      policy: data.policy || null,
      decision: data.decision || null,
      execution: data.execution || null,
      steps: data.steps || [],
    },
  };
}

/** A successful /llm/call as an assistant message. */
export function llmReplyMessage(provider, data) {
  return { content: data.reply, extra: { steps: [`${provider} · ${data.route} · ${data.latencyMs} ms`] } };
}

/**
 * A Privilege policy denial of an LLM prompt. A denial is the demo, so it is spoken in
 * the transcript rather than thrown. `details` is any object with optional
 * reason/message/provider/route.
 */
export function llmDenialMessage(provider, details) {
  return {
    content: `⚠️ Privilege denied this call. ${details.reason || details.message}`,
    extra: { steps: [`${details.provider || provider} · ${details.route || ''} · denied by policy`] },
  };
}
