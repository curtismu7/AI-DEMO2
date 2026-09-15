import { type PluginContext } from '@lmstudio/sdk';
import { configSchematics } from './config';
import { preprocess } from './promptPreprocessor';
import { toolsProvider } from './toolsProvider';

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withPromptPreprocessor(preprocess);
  context.withToolsProvider(toolsProvider);
}
