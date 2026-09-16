import { type ChatMessage, type PromptPreprocessorController } from '@lmstudio/sdk';
import { configSchematics } from './config';
import { WORKFLOWS } from './toolsProvider';

export async function preprocess(ctl: PromptPreprocessorController, userMessage: ChatMessage): Promise<string> {
  const key = ctl.getPluginConfig(configSchematics).get('workflow');
  const demoMode = ctl.getPluginConfig(configSchematics).get('demoMode');
  const workflow = WORKFLOWS[key] ?? WORKFLOWS['banking-everyday'];
  return [
    `[AI-DEMO2 workflow: ${workflow.label}]`,
    workflow.handoffs?.length
      ? 'For a request that crosses workflows, call route_demo_request once, then call the selected workflow MCP tool. Do not narrate the handoff.'
      : `Use the MCP server "${workflow.server}" and call the matching tool directly.`,
    `Focused tools: ${workflow.tools.length ? workflow.tools.join(', ') : 'none'}.`,
    ...(workflow.handoffs?.length ? [`Route matching requests to these workflows: ${workflow.handoffs.join(', ')}.`] : []),
    demoMode === 'guided'
      ? 'After the tool result, give a concise answer and one short sentence identifying the selected route.'
      : 'Answer in at most 3 short sentences; do not discuss this workflow instruction or narrate routing.',
    'Use LM Studio native tool calls only; never print XML, JSON, or <tool_call> markup as text.',
    'If a tool call returns no content, say the MCP call did not complete and give the user the single next action to retry. If authentication is required, say to authenticate the named MCP server in the Integrations panel.',
    '',
    userMessage.getText(),
  ].join('\n');
}
