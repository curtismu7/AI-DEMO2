#!/usr/bin/env node
// Validate the checked-in LM Studio workflow contract before installing presets.
'use strict';

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'demo-steps.json'), 'utf8'));
const workflows = [...manifest.steps, ...manifest.openSearchUseCases];
const expectedCount = 23;
const errors = [];
const ids = new Set();

if (workflows.length !== expectedCount) errors.push(`expected ${expectedCount} workflows, found ${workflows.length}`);
for (const workflow of workflows) {
  if (!workflow.id || ids.has(workflow.id)) errors.push(`duplicate or missing id: ${workflow.id || '<missing>'}`);
  ids.add(workflow.id);
  if (!workflow.group || !workflow.label) errors.push(`${workflow.id}: missing group or label`);
  if (!(workflow.server || manifest.server)) errors.push(`${workflow.id}: missing MCP server`);
  if (!Array.isArray(workflow.tools)) errors.push(`${workflow.id}: tools must be an array`);
  if (!Array.isArray(workflow.starters) || workflow.starters.length === 0) errors.push(`${workflow.id}: missing starter prompts`);
  if (workflow.handoffs && workflow.handoffs.some((target) => !manifest.steps.some((candidate) => candidate.id === target))) {
    errors.push(`${workflow.id}: handoff target is not a Demo Step`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(`Validated ${workflows.length} LM Studio workflows.`);
