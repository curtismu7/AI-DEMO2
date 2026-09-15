#!/usr/bin/env node
// Install the checked-in Demo Steps and OpenSearch workflows as LM Studio
// config presets. LM Studio imports these from ~/.lmstudio/config-presets.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-steps.json'), 'utf8'));
const outputDir = path.join(os.homedir(), '.lmstudio', 'config-presets');
const workflows = [...manifest.steps, ...manifest.openSearchUseCases];

fs.mkdirSync(outputDir, { recursive: true });
for (const workflow of workflows) {
  const systemPrompt = [
    manifest.systemPrompt,
    `Current workflow: ${workflow.label}.`,
    workflow.server ? `Use MCP server: ${workflow.server}.` : '',
    `Use only these MCP tools: ${workflow.tools.length ? workflow.tools.join(', ') : 'none'}.`,
    workflow.handoffs?.length
      ? `This is a routing workflow. Route matching requests to: ${workflow.handoffs.join(', ')}.`
      : '',
    `Suggested prompts: ${workflow.starters.join(' | ')}`,
  ].filter(Boolean).join('\n');
  const preset = {
    name: `Demo · ${workflow.group} · ${workflow.label}`,
    inference_params: {
      input_prefix: '',
      input_suffix: '',
      antiprompt: [''],
      pre_prompt_prefix: '',
      pre_prompt_suffix: '',
      pre_prompt: systemPrompt,
    },
  };
  const filename = `${workflow.id}.preset.json`;
  fs.writeFileSync(path.join(outputDir, filename), `${JSON.stringify(preset, null, 2)}\n`);
}
console.log(`Installed ${workflows.length} LM Studio presets in ${outputDir}`);
