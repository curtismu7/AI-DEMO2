import { type PluginContext } from '@lmstudio/sdk';
import { configSchematics } from './config';
import { preprocess } from './promptPreprocessor';

export async function main(context: PluginContext) {
  context.withConfigSchematics(configSchematics);
  context.withPromptPreprocessor(preprocess);
}
