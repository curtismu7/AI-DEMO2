import { type ChatMessage, type PromptPreprocessorController } from '@lmstudio/sdk';
import { configSchematics } from './config';
import { WORKFLOWS } from './toolsProvider';

export async function preprocess(ctl: PromptPreprocessorController, userMessage: ChatMessage): Promise<string> {
  const key = ctl.getPluginConfig(configSchematics).get('workflow');
  const workflow = WORKFLOWS[key] ?? WORKFLOWS['banking-everyday'];
  return [
    `[AI-DEMO2 workflow: ${workflow.label}]`,
    `Use the MCP server "${workflow.server}" and call the matching tool directly.`,
    `Focused tools: ${workflow.tools.join(', ')}.`,
    'Be concise; do not discuss this workflow instruction or call a workflow-explanation tool.',
    '',
    userMessage.getText(),
  ].join('\n');
}
