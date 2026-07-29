'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../routes');
const OUTPUT_FILE = path.join(__dirname, '../../demo_api_ui/src/data/protocolFlows.json');

/**
 * Parse JSDoc comments for @flow, @actor, @step, @expects, @branch tags
 */
function parseFlowAnnotation(jsdocComment) {
  const lines = jsdocComment.split('\n');
  const result = {};

  for (const line of lines) {
    const match = line.match(/@(\w+)\s+(.+)/);
    if (!match) continue;

    const [, tag, value] = match;
    if (tag === 'flow') {
      result.flowId = value.trim();
    } else if (tag === 'actor') {
      result.actor = value.trim();
    } else if (tag === 'step') {
      result.step = parseInt(value.trim(), 10);
    } else if (tag === 'expects') {
      result.expects = value.trim();
    } else if (tag === 'branch') {
      if (!result.branches) result.branches = [];
      result.branches.push(value.trim());
    }
  }

  return result;
}

/**
 * Extract all JSDoc comments from file content
 */
function extractJSDocComments(fileContent) {
  const regex = /\/\*\*\s*([\s\S]*?)\*\//g;
  const comments = [];
  let match;

  while ((match = regex.exec(fileContent)) !== null) {
    comments.push(match[1]);
  }

  return comments;
}

/**
 * Scan routes directory for files with @flow annotations
 */
function scanRoutesDir() {
  const routes = [];
  const files = fs.readdirSync(ROUTES_DIR);

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const filePath = path.join(ROUTES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const jsdocs = extractJSDocComments(content);
    for (const doc of jsdocs) {
      const annotation = parseFlowAnnotation(doc);
      if (annotation.flowId) {
        routes.push({ file, annotation });
      }
    }
  }

  return routes;
}

/**
 * Build flow specs from route annotations
 */
function buildFlowSpecs(routes) {
  const flows = {};

  for (const { file, annotation } of routes) {
    const { flowId, actor, step, expects, branches } = annotation;

    if (!flows[flowId]) {
      flows[flowId] = {
        id: flowId,
        name: toTitleCase(flowId),
        description: `Protocol flow: ${flowId}`,
        actors: [],
        steps: [],
        branches: []
      };
    }

    // Add actor if new
    if (actor && !flows[flowId].actors.includes(actor)) {
      flows[flowId].actors.push(actor);
    }

    // Add step (deduplicate by step number)
    if (step !== undefined && !isNaN(step) && actor) {
      if (!flows[flowId].steps.some(s => s.step === step)) {
        flows[flowId].steps.push({
          id: `step-${step}`,
          actor,
          action: `Step ${step}`,
          step,
          expected: expects ? safeParseJson(expects) : {}
        });
      }
    }

    // Add branches
    if (branches && Array.isArray(branches)) {
      for (const branch of branches) {
        if (!flows[flowId].branches.includes(branch)) {
          flows[flowId].branches.push(branch);
        }
      }
    }
  }

  // Sort steps by order within each flow
  for (const flowId of Object.keys(flows)) {
    flows[flowId].steps.sort((a, b) => a.step - b.step);
  }

  return flows;
}

/**
 * Safely parse JSON string, return empty object on failure
 */
function safeParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

/**
 * Convert kebab-case or snake_case to Title Case
 */
function toTitleCase(str) {
  return str
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Main entry point
 */
async function main() {
  const routes = scanRoutesDir();
  const flows = buildFlowSpecs(routes);

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(flows, null, 2));
  console.log(`✅ Generated ${Object.keys(flows).length} protocol flows → ${OUTPUT_FILE}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
