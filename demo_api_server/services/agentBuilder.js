/**
 * Agent Builder — LangGraph StateGraph Factory
 * Creates fresh LangGraph agent per request with banking tools, system prompt, and auth context
 * 
 * Pattern (per LangGraph):
 * - StateGraph with defined state schema
 * - Nodes for agent reasoning and tool execution
 * - LangChain chat model with system prompt
 * - Tools from createMcpToolRegistry()
 * - Config-driven agent context (auth, tokens, events)
 */

const { StateGraph } = require('@langchain/langgraph');

const { ToolMessage } = require('@langchain/core/messages');
const { Annotation } = require('@langchain/langgraph');
const { createMcpToolRegistry } = require('../utils/mcpToolRegistry');
const { resolveMcpAccessTokenWithEvents, buildTokenEvent } = require('./agentMcpTokenService');

/**
 * WR-03: Hard cap on LangGraph node steps (agent ⇄ tools loop). Without this,
 * an LLM that keeps emitting tool_calls loops tools→agent→tools forever — only
 * the upstream HTTP timeout terminates it. Value mirrors
 * banking_agent_service/src/agentOrchestrator.ts MAX_TOOL_ITERATIONS = 10 for
 * cross-stack consistency. Passed to graph.invoke({ recursionLimit }).
 */
const MAX_TOOL_ITERATIONS = 10;

// Default models per provider
const DEFAULT_MODELS = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  groq:      'llama-3.1-8b-instant',
  google:    'gemini-2.0-flash',
  helix:     'gpt-4o-mini',
};

/**
 * LangGraph system prompt for banking agent
 */
const BANKING_AGENT_SYSTEM_PROMPT = `You are a banking assistant powered by LangGraph and MCP tools.

Your capabilities:
- Retrieve user accounts and balances
- Process transactions
- Manage account settings
- Provide banking information
- Answer financial questions

Always be helpful, accurate, and secure. For sensitive operations, you will be asked for consent before proceeding.

When a user asks you to perform an action:
1. Directly use the appropriate tool to get information or perform the action
2. Report results clearly and concisely
3. Ask for consent only if the action requires it

For simple queries like "show my accounts", "recent transactions", or "my balance" - directly execute the action without confirmation questions. Be concise and professional in all responses.`;

/**
 * Define the state schema for the banking agent
 */
const AgentAnnotation = Annotation.Root({
  messages: Annotation({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  userId: Annotation({
    reducer: (x, y) => y || x,
    default: () => '',
  }),
  userToken: Annotation({
    reducer: (x, y) => y || x,
    default: () => '',
  }),
  sessionId: Annotation({
    reducer: (x, y) => y || x,
    default: () => '',
  }),
  tokenEvents: Annotation({
    reducer: (x, y) => y || x,
    default: () => [],
  }),
  provider: Annotation({
    reducer: (x, y) => y || x,
    default: () => '',
  }),
});

/**
 * Create a fresh banking agent for a user request
 * 
 * @param {object} config - Agent configuration
 * @param {string} config.userId - PingOne user ID
 * @param {string} config.userToken - User's OAuth access token
 * @param {string} config.sessionId - Express session ID
 * @param {array} config.tokenEvents - Token event tracking array (passed by reference)
 * @param {object} config.langchainConfig - Session LLM config: { model, provider }
 * @returns {Promise<object>} LangGraph agent ready for invoke()
 */
/**
 * Ensure tool_call args is always a plain object.
 * Prevents API errors when args is empty string, undefined, or other non-object type.
 */
function normalizeToolCallArgs(args) {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args;
  if (typeof args === 'string' && args.length > 0) {
    try { return JSON.parse(args); } catch { return {}; }
  }
  return {};
}

async function createBankingAgent({ userId, userToken, sessionId, tokenEvents = [], langchainConfig = {}, subjectToken = null, req = null }) {
  console.log('[agentBuilder] === CREATE BANKING AGENT START ===');
  console.log('[agentBuilder] userId:', userId);
  console.log('[agentBuilder] userToken present:', !!userToken);
  console.log('[agentBuilder] userToken length:', userToken?.length || 0);
  console.log('[agentBuilder] sessionId:', sessionId);
  console.log('[agentBuilder] tokenEvents initial count:', tokenEvents?.length || 0);

  try {
    // Validate inputs
    if (!userId || !userToken) {
      console.error('[agentBuilder] ERROR: Missing required inputs - userId:', !!userId, 'userToken:', !!userToken);
      throw Object.assign(new Error('[agentBuilder] Agent requires userId and userToken'), { source: 'agentBuilder' });
    }

    // Perform token exchange to get MCP access token and generate token events
    console.log('[agentBuilder] Performing token exchange for MCP access...');
    const mockReq = {
      session: { oauthTokens: { accessToken: userToken }, id: sessionId },
      sessionID: sessionId,
    };
    
    let agentToken;
    let exchangeEvents;
    try {
      const result = await resolveMcpAccessTokenWithEvents(mockReq, 'banking_agent');
      agentToken = result.token;
      exchangeEvents = result.tokenEvents;
      console.log('[agentBuilder] Token exchange completed, agentToken present:', !!agentToken);
      console.log('[agentBuilder] agentToken length:', agentToken?.length || 0);
      console.log('[agentBuilder] Exchange events count:', exchangeEvents?.length || 0);
    } catch (exchangeError) {
      console.error('[agentBuilder] ERROR: Token exchange failed:', exchangeError.message);
      console.error('[agentBuilder] Exchange error stack:', exchangeError.stack);
      // Preserve TOKEN_INACTIVE so processAgentMessage can re-throw it and the route returns 401
      if (exchangeError.code === 'TOKEN_INACTIVE') throw exchangeError;
      throw Object.assign(new Error(`[agentBuilder] Token exchange failed: ${exchangeError.message}`), { source: 'agentBuilder', cause: exchangeError });
    }

    // Add exchange events to the token events array
    if (exchangeEvents && exchangeEvents.length > 0) {
      console.log('[agentBuilder] Adding exchange events to tokenEvents array');
      tokenEvents.push(...exchangeEvents);
      console.log('[agentBuilder] tokenEvents count after adding:', tokenEvents.length);
    }

        // Initialize LLM provider — resolution is centralized (T-3).
    let model;
    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { provider } = resolveLlmProvider(langchainConfig);
    const selectedModel = langchainConfig?.model || DEFAULT_MODELS[provider];

    if (provider === 'helix') {
      // Helix LLM provider (Ping's internal AI platform)
      console.log(`[agentBuilder] Initializing Helix LLM: ${selectedModel}`);
      try {
        const { callHelixAgent } = require('./helixLlmService');
        const { RunnableLambda } = require('@langchain/core/runnables');

        const helixConfig = {
          helix_base_url: langchainConfig.helix_base_url,
          helix_api_key: langchainConfig.helix_api_key,
          helix_environment_id: langchainConfig.helix_environment_id,
          helix_agent_id: langchainConfig.helix_agent_id,
          helix_prompt_field_id: langchainConfig.helix_prompt_field_id,
        };

        model = RunnableLambda.from(async (messages) => {
          return await callHelixAgent(helixConfig, messages);
        });
        console.log(`[agentBuilder] LLM initialized: helix/${selectedModel}`);
      } catch (helixErr) {
        console.error('[agentBuilder] ERROR: Helix initialization failed:', helixErr.message);
        throw Object.assign(new Error('[agentBuilder] Helix LLM not available: ' + helixErr.message), { source: 'agentBuilder' });
      }
    } else {
      // Provider not recognized — no LLM available for this path
      throw Object.assign(new Error(`[agentBuilder] No LLM available for provider "${provider}". Configure Helix credentials.`), { source: 'agentBuilder' });
    }

    // Define the agent node with tools
    const tools = createMcpToolRegistry();
    
    async function agentNode(state) {
      const messages = [
        { role: 'system', content: BANKING_AGENT_SYSTEM_PROMPT },
        ...state.messages,
      ];
      const config = {
        configurable: {
          agentContext: {
            agentToken,
            userId,
            userToken,
            subjectToken,
            tokenEvents,
            req, // For token event recording
          },
        },
      };
      // CR-01: previously had a 429 → Anthropic fallback branch here, but
      // `fallbackModel` was never declared and `provider` is const — the
      // branch was dead code that would throw ReferenceError if reached.
      // Removed for graceful 429 failure (caught by processAgentMessage and
      // surfaced as "Too many requests."). If a real fallback model is
      // desired in future, declare it above and re-introduce the branch.
      const response = await model.bindTools(tools).invoke(messages, config);

      // M3: the agent's reasoning / tool-selection step. The LLM deciding
      // WHICH tool(s) to call (or none) is a core part of "everything that is
      // going on" and previously had no chain representation — only the
      // downstream tool execution did. Record it into the same by-reference
      // tokenEvents array that reaches the Token Chain. No prompt/PII content,
      // just the decision.
      try {
        const selected = (response.tool_calls || []).map((tc) => tc.name);
        tokenEvents.push(buildTokenEvent(
          'agent-reasoning',
          'Agent Reasoning — LLM Tool Selection',
          selected.length > 0 ? 'success' : 'skipped',
          null,
          selected.length > 0
            ? `The agent model evaluated the request and selected ${selected.length} tool${selected.length === 1 ? '' : 's'}: ${selected.join(', ')}.`
            : 'The agent model answered directly without selecting any banking tool.',
          { rfc: 'Agent (LLM)', selectedTools: selected }
        ));
      } catch (_reasonEvtErr) { /* non-fatal — never block the agent on chain bookkeeping */ }

      // Handle LangChain response format - it may have tool_calls or content as array
      let messageContent;
      if (response.tool_calls && response.tool_calls.length > 0) {
        // Normalize tool_call args to always be plain objects.
        // Prevents Anthropic API "Input should be a valid dictionary" errors
        // in cross-provider fallback or empty-schema tools like get_my_accounts.
        for (const tc of response.tool_calls) {
          tc.args = normalizeToolCallArgs(tc.args);
        }
        return { messages: [response] };
      } else if (Array.isArray(response.content)) {
        // Content might be an array of content blocks
        messageContent = response.content.map(c => typeof c === 'string' ? c : JSON.stringify(c)).join('\n');
      } else {
        // Ensure response is in the correct message format
        messageContent = response.content || response.text || JSON.stringify(response);
      }
      return { messages: [{ role: 'assistant', content: messageContent }] };
    }

    // Tool execution node
    async function toolNode(state) {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage?.tool_calls) {
        const toolMessages = [];
        for (const toolCall of lastMessage.tool_calls) {
          const tool = tools.find(t => t.name === toolCall.name);
          if (tool) {
            try {
              const args = normalizeToolCallArgs(toolCall.args);
              const result = await tool.invoke(args, {
                configurable: {
                  agentContext: {
                    agentToken,
                    userId,
                    tokenEvents,
                  },
                },
              });
              // Ensure result is a string for React rendering
              const resultString = typeof result === 'string' ? result : JSON.stringify(result);
              // Return individual tool message for each tool call
              toolMessages.push(new ToolMessage({
                content: resultString,
                tool_call_id: toolCall.id,
              }));
            } catch (error) {
              toolMessages.push(new ToolMessage({
                content: `Error: ${error.message}`,
                tool_call_id: toolCall.id,
              }));
            }
          }
        }
        return { messages: toolMessages };
      }
      return { messages: [] };
    }

    // Create the graph with conditional edge for tool calls
    const workflow = new StateGraph(AgentAnnotation)
      .addNode('agent', agentNode)
      .addNode('tools', toolNode)
      .addEdge('__start__', 'agent')
      .addConditionalEdges(
        'agent',
        (state) => {
          const lastMessage = state.messages[state.messages.length - 1];
          return lastMessage?.tool_calls?.length > 0 ? 'tools' : '__end__';
        },
        {
          tools: 'tools',
          __end__: '__end__',
        }
      )
      .addEdge('tools', 'agent');

    // Compile the graph
    const app = workflow.compile();

    // Return the compiled graph with initial state
    return {
      graph: app,
      initialState: {
        messages: [],
        userId,
        userToken,
        sessionId,
        tokenEvents,
        provider,
      },
    };
  } catch (error) {
    console.error('[agentBuilder] Failed to create agent:', error.message);
    throw error;
  }
}

/**
 * Phase 2 (agent consolidation): expose the SAME tool list `createBankingAgent`
 * uses internally (line `const tools = createMcpToolRegistry()`), as a pure
 * getter that builds and executes NOTHING. The BFF reason-loop path
 * (bankingAgentLangGraphService) derives tool SCHEMAS for :3006 from this and
 * executes the SAME tool executors locally — no duplicate tool definitions.
 */
function getBankingToolDefinitions() {
  return createMcpToolRegistry();
}

module.exports = {
  createBankingAgent,
  getBankingToolDefinitions,
  BANKING_AGENT_SYSTEM_PROMPT,
  MAX_TOOL_ITERATIONS,
};
