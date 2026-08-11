'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../routes');
const SERVER_FILE = path.join(__dirname, '../server.js');
const OUTPUT_FILE = path.join(__dirname, '../../demo_api_ui/src/data/protocolFlows.json');

/**
 * Capture leading prose (lines before first @tag) for flow/step descriptions
 */
function captureLeadingProse(jsdocComment) {
  const lines = jsdocComment.split('\n');
  const prose = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const afterStar = trimmed.replace(/^\*\s?/, '').trim();
    if (afterStar.startsWith('@')) break;
    if (!afterStar) continue;
    prose.push(afterStar);
  }
  return prose.join(' ').trim();
}

/**
 * Parse JSDoc comments for @flow, @name, @rfc, @title, @actor, @to, @step, @body, @expects, @branch tags
 */
function parseFlowAnnotation(jsdocComment) {
  const lines = jsdocComment.split('\n');
  const result = {
    prose: captureLeadingProse(jsdocComment)
  };
  let seenRfc = false;
  let seenTitle = false;

  for (const line of lines) {
    const match = line.match(/@(\w+)\s+(.+)/);
    if (!match) continue;

    const [, tag, value] = match;
    if (tag === 'flow') {
      result.flowId = value.trim();
    } else if (tag === 'name') {
      result.displayName = value.trim();
    } else if (tag === 'rfc' && !seenRfc) {
      const trimmedValue = value.trim();
      const spaceIdx = trimmedValue.indexOf(' ');
      if (spaceIdx > 0) {
        result.rfcUrl = trimmedValue.substring(0, spaceIdx);
        result.rfcLabel = trimmedValue.substring(spaceIdx + 1);
        seenRfc = true;
      }
    } else if (tag === 'title' && !seenTitle) {
      result.stepTitle = value.trim();
      seenTitle = true;
    } else if (tag === 'actor') {
      result.actor = value.trim();
    } else if (tag === 'to') {
      result.toActor = value.trim();
    } else if (tag === 'step') {
      result.step = parseInt(value.trim(), 10);
    } else if (tag === 'expects') {
      result.expects = value.trim();
    } else if (tag === 'body') {
      result.body = value.trim();
    } else if (tag === 'branch') {
      if (!result.branches) result.branches = [];
      result.branches.push(value.trim());
    }
  }

  return result;
}

/**
 * Extract JSDoc comments plus the source that follows each one, so the route
 * call a comment documents can be read off the same scan.
 */
function extractJSDocComments(fileContent) {
  const regex = /\/\*\*\s*([\s\S]*?)\*\//g;
  const comments = [];
  let match;

  while ((match = regex.exec(fileContent)) !== null) {
    comments.push({ body: match[1], following: fileContent.slice(regex.lastIndex, regex.lastIndex + 400) });
  }

  return comments;
}

/**
 * Read the `router.<method>('<path>'` call a JSDoc block documents.
 * Returns null when the comment does not sit directly above a route.
 */
function parseRouteCall(followingSource) {
  const match = followingSource.match(/^\s*router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/);
  if (!match) return null;
  return { method: match[1].toUpperCase(), routePath: match[2] };
}

/**
 * Map each route file to the path prefix server.js mounts it under, so
 * generated endpoints are the URLs the app actually serves.
 */
function resolveMountPrefixes() {
  const prefixes = {};
  if (!fs.existsSync(SERVER_FILE)) return prefixes;

  const content = fs.readFileSync(SERVER_FILE, 'utf8');
  const varToFile = {};

  const requireRegex = /const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([\w-]+)['"]\)/g;
  let match;
  while ((match = requireRegex.exec(content)) !== null) {
    varToFile[match[1]] = `${match[2]}.js`;
  }

  // Tolerates extra middleware args between the mount path and the router
  // identifier (e.g. app.use('/x', express.json(), router)). The middleware
  // group is LAZY-OPTIONAL (`??`) so the simple two-arg case matches the
  // very next identifier without ever trying to expand; it only engages when
  // that direct match fails, and [^;] keeps it from tunneling past this
  // statement's own semicolon into an unrelated later app.use() call.
  const useRegex = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:[^;]*?,\s*)??(\w+)\s*\)/g;
  while ((match = useRegex.exec(content)) !== null) {
    const file = varToFile[match[2]];
    if (file && !prefixes[file]) prefixes[file] = match[1];
  }

  return prefixes;
}

/**
 * Scan routes directory for files with @flow annotations
 */
function scanRoutesDir() {
  const routes = [];
  const prefixes = resolveMountPrefixes();
  const files = fs.readdirSync(ROUTES_DIR);

  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const filePath = path.join(ROUTES_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');

    const jsdocs = extractJSDocComments(content);
    for (const doc of jsdocs) {
      const annotation = parseFlowAnnotation(doc.body);
      if (!annotation.flowId) continue;

      const call = parseRouteCall(doc.following);
      if (call) {
        annotation.method = call.method;
        annotation.endpoint = joinPath(prefixes[file] || '', call.routePath);
      }
      routes.push({ file, annotation });
    }
  }

  return routes;
}

/**
 * Join a mount prefix and a route path into one URL path.
 */
function joinPath(prefix, routePath) {
  const left = prefix.replace(/\/$/, '');
  const right = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${left}${right}` || '/';
}

/**
 * Build flow specs from route annotations
 */
function buildFlowSpecs(routes) {
  const flows = {};

  for (const { annotation } of routes) {
    const { flowId, displayName, prose, rfcUrl, rfcLabel, stepTitle, actor, toActor, step, expects, body, branches, method, endpoint } = annotation;

    if (!flows[flowId]) {
      flows[flowId] = {
        id: flowId,
        name: toTitleCase(flowId),
        description: `Protocol flow: ${flowId}`,
        actors: [],
        steps: [],
        branches: [],
        spec: null
      };
    }

    // @name overrides the naive title-caser, which mangles acronym flow IDs
    // (e.g. "ciba-hitl" -> "Ciba Hitl" instead of "CIBA / HITL").
    if (displayName) {
      flows[flowId].name = displayName;
    }

    // Set flow-level spec from first annotation with @rfc (prose is captured from each annotation)
    if (rfcUrl && rfcLabel && !flows[flowId].spec) {
      flows[flowId].spec = {
        url: rfcUrl,
        label: rfcLabel,
        title: displayName || toTitleCase(flowId),
        why: prose
      };
    }

    // Add actors in the order they appear (source first, then target)
    for (const name of [actor, toActor]) {
      if (name && !flows[flowId].actors.includes(name)) {
        flows[flowId].actors.push(name);
      }
    }

    // Add step (deduplicate by step number)
    if (step !== undefined && !Number.isNaN(step) && actor) {
      if (!flows[flowId].steps.some(s => s.step === step)) {
        const target = toActor || actor;
        const action = method && endpoint ? `${method} ${endpoint}` : `Step ${step}`;
        flows[flowId].steps.push({
          id: `step-${step}`,
          actor,
          fromActor: actor,
          toActor: target,
          action,
          label: action,
          method: method || null,
          endpoint: endpoint || null,
          step,
          title: stepTitle || null,
          description: prose || null,
          body: body ? safeParseJson(body) : null,
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
