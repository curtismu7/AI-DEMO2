#!/usr/bin/env node
/**
 * Reject PingGateway route conditions that IG's expression language cannot parse.
 *
 * Inside a single-quoted EL string the ONLY legal escapes are \' and \\. A regex
 * written the natural way — '^cmuir-mcp\.ping-devops\.com' — is a lexical error,
 * and IG's response is to log "is not a valid route" at startup and then serve a
 * bare 404 with no body. The deploy still reports success, the ConfigMap still
 * contains the file, and the endpoint is simply absent. Two routes shipped that
 * way before anything noticed.
 *
 * Use a character class ([.]) instead of a backslash escape for literal dots.
 *
 * Run: node ping-gateway/scripts/check-route-conditions.js
 */
const fs = require('fs');
const path = require('path');

const routesDir = path.join(__dirname, '..', 'config', 'routes');
const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.json'));

const problems = [];
for (const file of files) {
  const full = path.join(routesDir, file);
  let route;
  try {
    route = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    problems.push(`${file}: not valid JSON — ${err.message}`);
    continue;
  }
  const condition = route.condition;
  if (typeof condition !== 'string') continue;

  // Walk the condition, tracking whether we're inside a single-quoted EL string.
  let inString = false;
  for (let i = 0; i < condition.length; i += 1) {
    const ch = condition[i];
    if (!inString) {
      if (ch === "'") inString = true;
      continue;
    }
    if (ch === '\\') {
      const next = condition[i + 1];
      if (next !== "'" && next !== '\\') {
        problems.push(
          `${file}: illegal escape \\${next} in condition — IG allows only \\' and \\\\ ` +
            `inside '...'; use [${next}] instead of \\${next} for a literal.`,
        );
      }
      i += 1; // consume the escaped char either way
      continue;
    }
    if (ch === "'") inString = false;
  }
}

if (problems.length > 0) {
  console.error('PingGateway route conditions IG cannot parse:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s) across ${files.length} route file(s).`);
  process.exit(1);
}

console.log(`ok — ${files.length} route condition(s) parse-safe for IG's expression language`);
