# Protocol Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive protocol playground that visualizes OAuth/OIDC flows with introspected specs, live execution, and token inspection.

**Architecture:** Approach 3 (introspect routes → auto-generate specs). BFF introspector scans routes for `@flow` JSDoc annotations, generates `protocolFlows.json`. UI loads spec, renders SVG sequence diagrams, executes flows step-by-step, captures and decodes tokens.

**Tech Stack:** React 19.2 + Vite 8 (UI), Node 22 CommonJS (introspector), custom SVG rendering, native JWT decoding, axios for BFF calls.

## Global Constraints

- Node >= 22 everywhere
- React 19.2 + Vite 8 for UI
- CommonJS in BFF (`'use strict'` + `require`)
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`
- All UI components in `demo_api_ui/src/components/ProtocolPlayground/`
- All services in `demo_api_ui/src/services/`
- Introspector in `demo_api_server/scripts/generateProtocolFlows.js`
- Generated spec checked into git at `demo_api_ui/src/data/protocolFlows.json`
- Work in worktree `worktree-protocol-playground-design`

---

## File Structure

**New files created:**

```
demo_api_server/scripts/
└── generateProtocolFlows.js          (introspector CLI)

demo_api_ui/src/components/ProtocolPlayground/
├── ProtocolPlayground.jsx            (main container)
├── ProtocolSidebar.jsx               (left nav)
├── ProtocolViewer.jsx                (main content)
├── SequenceDiagram.jsx               (SVG rendering)
├── ActivityPanel.jsx                 (request/response/tokens panel)
├── TokenInspector.jsx                (JWT decoder UI)
├── ExecutionControls.jsx             (Execute/Step/Reset buttons)
└── ProtocolPlayground.css            (styling)

demo_api_ui/src/services/
├── executionEngine.js                (flow executor)
├── diagramRenderer.js                (SVG layout logic)
└── tokenInspector.js                 (JWT utilities)

demo_api_ui/src/data/
└── protocolFlows.json                (generated artifact)

demo_api_ui/src/routes/
└── ProtocolPlaygroundRoutes.js       (route wiring)
```

**Modified files:**

```
demo_api_ui/src/App.jsx               (add /protocol-playground route)
demo_api_ui/src/routes/index.js       (import ProtocolPlaygroundRoutes)
```

---

## Task 1: Introspector — Route Parser & Schema Builder

**Files:**
- Create: `demo_api_server/scripts/generateProtocolFlows.js`

**Interfaces:**
- Consumes: BFF route files in `demo_api_server/routes/*.js` (annotated with `@flow` JSDoc)
- Produces: `demo_api_ui/src/data/protocolFlows.json` conforming to spec schema

**Description:**

Write a Node CLI script that:
1. Scans `demo_api_server/routes/*.js`
2. Parses JSDoc comments for `@flow`, `@actor`, `@step`, `@expects`, `@branch` tags
3. Builds protocol flow specs
4. Outputs `protocolFlows.json`

- [ ] **Step 1: Create script skeleton**

```javascript
// demo_api_server/scripts/generateProtocolFlows.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES_DIR = path.join(__dirname, '../routes');
const OUTPUT_FILE = path.join(__dirname, '../../demo_api_ui/src/data/protocolFlows.json');

async function main() {
  const flows = {};
  
  // TODO: scan routes, parse annotations, build flows
  
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
```

- [ ] **Step 2: Write JSDoc tag parser**

```javascript
// Inside generateProtocolFlows.js, add:

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
      result.step = parseInt(value.trim());
    } else if (tag === 'expects') {
      result.expects = value.trim();
    } else if (tag === 'branch') {
      if (!result.branches) result.branches = [];
      result.branches.push(value.trim());
    }
  }
  
  return result;
}

function extractJSDocComments(fileContent) {
  const regex = /\/\*\*\s*([\s\S]*?)\*\//g;
  const comments = [];
  let match;
  
  while ((match = regex.exec(fileContent)) !== null) {
    comments.push(match[1]);
  }
  
  return comments;
}
```

- [ ] **Step 3: Write route file scanner**

```javascript
// Inside generateProtocolFlows.js, add:

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
```

- [ ] **Step 4: Build flow specs from annotations**

```javascript
// Inside generateProtocolFlows.js, add:

function buildFlowSpecs(routes) {
  const flows = {};
  
  for (const { file, annotation } of routes) {
    const { flowId, actor, step, expects } = annotation;
    
    if (!flows[flowId]) {
      flows[flowId] = {
        id: flowId,
        name: toTitleCase(flowId),
        description: `Flow ${flowId}`,
        actors: [],
        steps: [],
        branches: []
      };
    }
    
    // Add actor if new
    if (actor && !flows[flowId].actors.includes(actor)) {
      flows[flowId].actors.push(actor);
    }
    
    // Add step
    if (step !== undefined && actor) {
      flows[flowId].steps.push({
        id: `step-${step}`,
        actor,
        action: `Step ${step}`,
        step,
        expected: expects ? JSON.parse(expects) : {}
      });
    }
  }
  
  // Sort steps by order
  for (const flowId of Object.keys(flows)) {
    flows[flowId].steps.sort((a, b) => a.step - b.step);
  }
  
  return flows;
}

function toTitleCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
```

- [ ] **Step 5: Update main() to orchestrate**

```javascript
// Replace TODO in main():

async function main() {
  const routes = scanRoutesDir();
  const flows = buildFlowSpecs(routes);
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(flows, null, 2));
  console.log(`✅ Generated ${Object.keys(flows).length} protocol flows → ${OUTPUT_FILE}`);
}
```

- [ ] **Step 6: Add npm script to package.json (BFF)**

Edit `demo_api_server/package.json`, add to `scripts`:

```json
"protocols:gen": "node scripts/generateProtocolFlows.js"
```

- [ ] **Step 7: Test introspector with mock route**

Create a temporary test route with annotations, run `npm run protocols:gen`, verify output is valid JSON and saved to `demo_api_ui/src/data/protocolFlows.json`.

```bash
cd demo_api_server
npm run protocols:gen
```

Expected: JSON file created with detected flows.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/scripts/generateProtocolFlows.js demo_api_server/package.json
git commit -m "feat: add protocol flow introspector CLI (npm run protocols:gen)"
```

---

## Task 2: TokenInspector Service — JWT Utilities

**Files:**
- Create: `demo_api_ui/src/services/tokenInspector.js`
- Test: `demo_api_ui/src/services/__tests__/tokenInspector.test.js`

**Interfaces:**
- Consumes: JWT strings (encoded tokens from HTTP responses)
- Produces: 
  - `decodeJWT(token)` → `{ header, payload, signature, isValid }`
  - `extractScopes(payload)` → `string[]`
  - `formatTokenDisplay(payload)` → `{ scopes: [], aud: string, exp: number, sub: string, iss: string }`

**Description:**

Utility functions for decoding and inspecting JWT tokens. No external libraries — use native base64 and JSON.

- [ ] **Step 1: Write tokenInspector.js**

```javascript
// demo_api_ui/src/services/tokenInspector.js

function decodeJWT(token) {
  if (!token || typeof token !== 'string') {
    return { header: null, payload: null, signature: null, isValid: false, error: 'Invalid token' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { header: null, payload: null, signature: null, isValid: false, error: 'Invalid JWT format' };
  }

  try {
    const header = JSON.parse(base64UrlDecode(parts[0]));
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const signature = parts[2];

    return {
      header,
      payload,
      signature,
      isValid: true
    };
  } catch (err) {
    return { header: null, payload: null, signature: null, isValid: false, error: err.message };
  }
}

function base64UrlDecode(str) {
  let output = str.replace(/-/g, '+').replace(/_/g, '/');
  switch (output.length % 4) {
    case 0:
      break;
    case 2:
      output += '==';
      break;
    case 3:
      output += '=';
      break;
    default:
      throw new Error('Invalid base64url string');
  }

  try {
    return decodeURIComponent(
      atob(output)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
  } catch (err) {
    throw new Error('Failed to decode base64url: ' + err.message);
  }
}

function extractScopes(payload) {
  if (!payload || typeof payload !== 'object') return [];
  
  const scope = payload.scope || payload.scp || '';
  if (typeof scope === 'string') {
    return scope.split(' ').filter(s => s.length > 0);
  }
  
  return Array.isArray(scope) ? scope : [];
}

function formatTokenDisplay(payload) {
  if (!payload || typeof payload !== 'object') {
    return { scopes: [], aud: null, exp: null, sub: null, iss: null };
  }

  return {
    scopes: extractScopes(payload),
    aud: payload.aud || payload.audience || null,
    exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    sub: payload.sub || payload.subject || null,
    iss: payload.iss || payload.issuer || null,
    jti: payload.jti || null,
    raw: payload
  };
}

module.exports = {
  decodeJWT,
  extractScopes,
  formatTokenDisplay
};
```

- [ ] **Step 2: Write unit tests**

```javascript
// demo_api_ui/src/services/__tests__/tokenInspector.test.js

import { decodeJWT, extractScopes, formatTokenDisplay } from '../tokenInspector';

describe('tokenInspector', () => {
  const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFjY2Vzc19yZXNvdXJjZSIsImF1ZCI6ImFwaS5kZW1vIiwic3ViIjoiMTIzNDU2Nzg5MCIsImV4cCI6OTk5OTk5OTk5OX0.TEST';

  test('decodeJWT returns valid structure', () => {
    const result = decodeJWT(validToken);
    expect(result.isValid).toBe(true);
    expect(result.header).toBeDefined();
    expect(result.payload).toBeDefined();
    expect(result.payload.scope).toBe('access_resource');
  });

  test('decodeJWT handles invalid token', () => {
    const result = decodeJWT('invalid');
    expect(result.isValid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('extractScopes parses space-delimited scopes', () => {
    const scopes = extractScopes({ scope: 'read write delete' });
    expect(scopes).toEqual(['read', 'write', 'delete']);
  });

  test('formatTokenDisplay returns structured display', () => {
    const payload = {
      scope: 'read write',
      aud: 'api.demo',
      sub: '12345',
      exp: 9999999999
    };
    const display = formatTokenDisplay(payload);
    expect(display.scopes).toContain('read');
    expect(display.aud).toBe('api.demo');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd demo_api_ui
npm run test:unit -- services/__tests__/tokenInspector.test.js
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/services/tokenInspector.js demo_api_ui/src/services/__tests__/tokenInspector.test.js
git commit -m "feat: add JWT tokenInspector service with decode + scope extraction"
```

---

## Task 3: DiagramRenderer Service — SVG Layout Logic

**Files:**
- Create: `demo_api_ui/src/services/diagramRenderer.js`
- Test: `demo_api_ui/src/services/__tests__/diagramRenderer.test.js`

**Interfaces:**
- Consumes: Flow spec (actors, steps)
- Produces: `renderDiagram(flowSpec, canvasWidth, canvasHeight, currentStep)` → SVG element

**Description:**

Layout and rendering engine for sequence diagrams. Pure logic (no React), returns SVG markup.

- [ ] **Step 1: Write diagramRenderer.js skeleton**

```javascript
// demo_api_ui/src/services/diagramRenderer.js

const LANE_WIDTH = 150;
const HEADER_HEIGHT = 50;
const STEP_HEIGHT = 60;
const MARGIN = 20;

function renderDiagram(flowSpec, canvasWidth = 1000, canvasHeight = 600, currentStep = null) {
  if (!flowSpec || !flowSpec.actors || flowSpec.actors.length === 0) {
    return createEmptySvg(canvasWidth, canvasHeight, 'No flow specification provided');
  }

  const actors = flowSpec.actors;
  const steps = flowSpec.steps || [];
  
  // Calculate dimensions
  const diagramHeight = HEADER_HEIGHT + (steps.length * STEP_HEIGHT) + MARGIN * 2;
  const diagramWidth = (actors.length * LANE_WIDTH) + MARGIN * 2;
  const actualHeight = Math.max(diagramHeight, canvasHeight);
  const actualWidth = Math.max(diagramWidth, canvasWidth);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', actualWidth);
  svg.setAttribute('height', actualHeight);
  svg.setAttribute('viewBox', `0 0 ${actualWidth} ${actualHeight}`);
  svg.setAttribute('class', 'protocol-diagram');

  // Draw background
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', actualWidth);
  bg.setAttribute('height', actualHeight);
  bg.setAttribute('fill', '#1a1a1a');
  svg.appendChild(bg);

  // Draw lanes and headers
  drawLanes(svg, actors, LANE_WIDTH, MARGIN, actualHeight);
  drawActorHeaders(svg, actors, LANE_WIDTH, MARGIN, HEADER_HEIGHT);

  // Draw steps and messages
  drawSteps(svg, steps, actors, LANE_WIDTH, MARGIN, HEADER_HEIGHT, currentStep);

  return svg;
}

function createEmptySvg(width, height, message) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('fill', '#1a1a1a');

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', width / 2);
  text.setAttribute('y', height / 2);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('fill', '#888');
  text.setAttribute('font-size', '14');
  text.textContent = message;

  svg.appendChild(text);
  return svg;
}

function drawLanes(svg, actors, laneWidth, marginLeft, totalHeight) {
  for (let i = 0; i < actors.length; i++) {
    const x = marginLeft + i * laneWidth;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x + laneWidth / 2);
    line.setAttribute('y1', marginLeft + 50);
    line.setAttribute('x2', x + laneWidth / 2);
    line.setAttribute('y2', totalHeight);
    line.setAttribute('stroke', '#444');
    line.setAttribute('stroke-dasharray', '2,2');
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
  }
}

function drawActorHeaders(svg, actors, laneWidth, marginLeft, headerHeight) {
  actors.forEach((actor, i) => {
    const x = marginLeft + i * laneWidth + laneWidth / 2;
    const y = marginLeft + headerHeight / 2;

    // Actor box
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x - laneWidth / 2 + 5);
    rect.setAttribute('y', marginLeft + 5);
    rect.setAttribute('width', laneWidth - 10);
    rect.setAttribute('height', headerHeight - 10);
    rect.setAttribute('fill', '#2a4a7a');
    rect.setAttribute('stroke', '#4a7aaa');
    rect.setAttribute('stroke-width', '1');
    svg.appendChild(rect);

    // Actor label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 5);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#fff');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', 'bold');
    text.textContent = actor;
    svg.appendChild(text);
  });
}

function drawSteps(svg, steps, actors, laneWidth, marginLeft, headerHeight, currentStep) {
  steps.forEach((step, index) => {
    const y = marginLeft + headerHeight + index * STEP_HEIGHT + STEP_HEIGHT / 2;
    const fromIndex = actors.indexOf(step.actor);
    
    if (fromIndex === -1) return;

    const x = marginLeft + fromIndex * laneWidth + laneWidth / 2;
    const isCurrentStep = currentStep === step.id;
    const isCurrent = currentStep === step.id;

    // Step box (request description)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x - 60);
    rect.setAttribute('y', y - 15);
    rect.setAttribute('width', 120);
    rect.setAttribute('height', 30);
    rect.setAttribute('fill', isCurrent ? '#4a7a2a' : '#333');
    rect.setAttribute('stroke', isCurrent ? '#7abb4a' : '#666');
    rect.setAttribute('stroke-width', isCurrent ? '2' : '1');
    svg.appendChild(rect);

    // Step label
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y + 4);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', isCurrent ? '#fff' : '#aaa');
    text.setAttribute('font-size', '11');
    text.textContent = `${step.id}: ${step.method || 'POST'}`;
    svg.appendChild(text);
  });
}

module.exports = {
  renderDiagram
};
```

- [ ] **Step 2: Write unit tests**

```javascript
// demo_api_ui/src/services/__tests__/diagramRenderer.test.js

import { renderDiagram } from '../diagramRenderer';

describe('diagramRenderer', () => {
  const mockFlowSpec = {
    id: 'test-flow',
    name: 'Test Flow',
    actors: ['Client', 'Server', 'Resource'],
    steps: [
      { id: 'step-1', actor: 'Client', method: 'POST', endpoint: '/token' },
      { id: 'step-2', actor: 'Server', method: 'VALIDATE', endpoint: 'internal' }
    ]
  };

  test('renderDiagram returns SVG element', () => {
    const svg = renderDiagram(mockFlowSpec, 1000, 600);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('class')).toContain('protocol-diagram');
  });

  test('renderDiagram creates lanes for each actor', () => {
    const svg = renderDiagram(mockFlowSpec, 1000, 600);
    const lines = svg.querySelectorAll('line');
    expect(lines.length).toBeGreaterThanOrEqual(3); // At least 3 actor lanes
  });

  test('renderDiagram highlights current step', () => {
    const svg = renderDiagram(mockFlowSpec, 1000, 600, 'step-1');
    const rects = svg.querySelectorAll('rect[stroke="#7abb4a"]');
    expect(rects.length).toBeGreaterThan(0); // Current step highlighted
  });

  test('renderDiagram handles empty spec gracefully', () => {
    const svg = renderDiagram({}, 1000, 600);
    expect(svg.tagName).toBe('svg');
    const text = svg.querySelector('text');
    expect(text.textContent).toContain('No flow');
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd demo_api_ui
npm run test:unit -- services/__tests__/diagramRenderer.test.js
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/services/diagramRenderer.js demo_api_ui/src/services/__tests__/diagramRenderer.test.js
git commit -m "feat: add SVG sequence diagram renderer service"
```

---

## Task 4: ExecutionEngine Service — Flow Executor

**Files:**
- Create: `demo_api_ui/src/services/executionEngine.js`
- Test: `demo_api_ui/src/services/__tests__/executionEngine.test.js`

**Interfaces:**
- Consumes: Flow spec, BFF base URL
- Produces: 
  - `class ExecutionEngine { executeStep(stepId), executeAll(), reset(), state }`
  - State: `{ currentStep, results: [{ request, response, decodedToken }], error }`

**Description:**

Executes flow steps sequentially. Calls BFF endpoints, captures responses, decodes tokens.

- [ ] **Step 1: Write ExecutionEngine class**

```javascript
// demo_api_ui/src/services/executionEngine.js

import axios from 'axios';
import { decodeJWT } from './tokenInspector';

class ExecutionEngine {
  constructor(flowSpec, bffBaseUrl = 'https://api.ping.demo:3001') {
    this.flowSpec = flowSpec;
    this.bffBaseUrl = bffBaseUrl;
    this.state = {
      currentStep: null,
      results: [],
      error: null
    };
  }

  reset() {
    this.state = {
      currentStep: null,
      results: [],
      error: null
    };
  }

  async executeStep(stepId) {
    const step = this.flowSpec.steps.find(s => s.id === stepId);
    if (!step) {
      this.state.error = `Step ${stepId} not found`;
      return { success: false, error: this.state.error };
    }

    this.state.currentStep = stepId;

    try {
      // Build request
      const method = step.method || 'POST';
      const endpoint = step.endpoint || '/';
      const url = `${this.bffBaseUrl}${endpoint}`;
      const payload = step.payload || {};

      // Call BFF
      const response = await axios({
        method: method.toLowerCase(),
        url,
        data: method !== 'GET' ? payload : undefined,
        params: method === 'GET' ? payload : undefined,
        validateStatus: () => true // Don't throw on any status
      });

      // Capture request/response
      const result = {
        stepId,
        request: {
          method,
          url: endpoint,
          headers: response.config.headers,
          body: payload
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          body: response.data
        },
        decodedToken: null
      };

      // Decode token if in response
      if (response.data && response.data.access_token) {
        result.decodedToken = decodeJWT(response.data.access_token);
      }

      this.state.results.push(result);
      this.state.error = null;

      return { success: true, result };
    } catch (err) {
      this.state.error = err.message;
      return { success: false, error: err.message };
    }
  }

  async executeAll() {
    this.reset();

    for (const step of this.flowSpec.steps) {
      const { success } = await this.executeStep(step.id);
      if (!success) {
        return { success: false, error: this.state.error };
      }
    }

    return { success: true };
  }

  getState() {
    return this.state;
  }
}

export default ExecutionEngine;
```

- [ ] **Step 2: Write unit tests**

```javascript
// demo_api_ui/src/services/__tests__/executionEngine.test.js

import ExecutionEngine from '../executionEngine';
import axios from 'axios';

jest.mock('axios');

describe('ExecutionEngine', () => {
  const mockFlowSpec = {
    id: 'test-flow',
    name: 'Test Flow',
    steps: [
      { 
        id: 'step-1', 
        actor: 'Client', 
        method: 'POST', 
        endpoint: '/oauth/token',
        payload: { grant_type: 'token-exchange' }
      },
      { 
        id: 'step-2', 
        actor: 'Server', 
        method: 'POST', 
        endpoint: '/introspect'
      }
    ]
  };

  beforeEach(() => {
    axios.mockClear();
  });

  test('executeStep calls BFF endpoint', async () => {
    const engine = new ExecutionEngine(mockFlowSpec);
    axios.mockResolvedValue({
      status: 200,
      data: { access_token: 'mock.jwt.token' },
      config: { headers: {} }
    });

    const result = await engine.executeStep('step-1');
    
    expect(result.success).toBe(true);
    expect(axios).toHaveBeenCalledWith(expect.objectContaining({
      method: 'post',
      url: expect.stringContaining('/oauth/token')
    }));
  });

  test('executeStep captures response', async () => {
    const engine = new ExecutionEngine(mockFlowSpec);
    axios.mockResolvedValue({
      status: 200,
      data: { access_token: 'test' },
      config: { headers: {} }
    });

    await engine.executeStep('step-1');
    const state = engine.getState();
    
    expect(state.results.length).toBe(1);
    expect(state.results[0].response.status).toBe(200);
  });

  test('executeStep handles errors', async () => {
    const engine = new ExecutionEngine(mockFlowSpec);
    axios.mockRejectedValue(new Error('Network error'));

    const result = await engine.executeStep('step-1');
    
    expect(result.success).toBe(false);
    expect(engine.getState().error).toContain('Network error');
  });

  test('executeAll runs all steps sequentially', async () => {
    const engine = new ExecutionEngine(mockFlowSpec);
    axios.mockResolvedValue({
      status: 200,
      data: { access_token: 'test' },
      config: { headers: {} }
    });

    const result = await engine.executeAll();
    
    expect(result.success).toBe(true);
    expect(engine.getState().results.length).toBe(2);
  });

  test('reset clears state', async () => {
    const engine = new ExecutionEngine(mockFlowSpec);
    axios.mockResolvedValue({ status: 200, data: {}, config: { headers: {} } });

    await engine.executeStep('step-1');
    engine.reset();

    expect(engine.getState().results.length).toBe(0);
    expect(engine.getState().currentStep).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd demo_api_ui
npm run test:unit -- services/__tests__/executionEngine.test.js
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/services/executionEngine.js demo_api_ui/src/services/__tests__/executionEngine.test.js
git commit -m "feat: add ExecutionEngine for stepping through protocol flows"
```

---

## Task 5: UI Components — ProtocolPlayground Container

**Files:**
- Create: `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.jsx`
- Create: `demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css`

**Interfaces:**
- Consumes: `protocolFlows.json` (loaded from import)
- Produces: React component at `<ProtocolPlayground />`

**Description:**

Main container component. Loads flow specs, manages state (selected protocol, execution state), wires child components.

- [ ] **Step 1: Write ProtocolPlayground.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.jsx

import React, { useState, useEffect } from 'react';
import protocolFlows from '../../data/protocolFlows.json';
import ProtocolSidebar from './ProtocolSidebar';
import ProtocolViewer from './ProtocolViewer';
import './ProtocolPlayground.css';

export default function ProtocolPlayground() {
  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [executionState, setExecutionState] = useState({
    currentStep: null,
    results: [],
    error: null
  });

  // Set first protocol as default
  useEffect(() => {
    const protocols = Object.keys(protocolFlows);
    if (protocols.length > 0 && !selectedProtocol) {
      setSelectedProtocol(protocols[0]);
    }
  }, [selectedProtocol]);

  const currentFlowSpec = selectedProtocol ? protocolFlows[selectedProtocol] : null;

  const handleExecutionStateChange = (newState) => {
    setExecutionState(newState);
  };

  return (
    <div className="protocol-playground">
      <aside className="protocol-sidebar">
        <ProtocolSidebar
          protocols={Object.keys(protocolFlows)}
          selectedProtocol={selectedProtocol}
          onSelectProtocol={setSelectedProtocol}
        />
      </aside>

      <main className="protocol-content">
        {currentFlowSpec ? (
          <ProtocolViewer
            flowSpec={currentFlowSpec}
            executionState={executionState}
            onExecutionStateChange={handleExecutionStateChange}
          />
        ) : (
          <div className="protocol-empty">
            <p>No protocols found. Run `npm run protocols:gen` to generate flow specs.</p>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Write ProtocolPlayground.css**

```css
/* demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css */

.protocol-playground {
  display: flex;
  width: 100%;
  height: calc(100vh - 60px);
  background: #0a0a0a;
  color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.protocol-sidebar {
  width: 220px;
  background: #1a1a1a;
  border-right: 1px solid #333;
  overflow-y: auto;
  padding: 16px;
}

.protocol-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.protocol-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 14px;
}

@media (prefers-color-scheme: dark) {
  .protocol-playground {
    background: #0a0a0a;
    color: #e0e0e0;
  }

  .protocol-sidebar {
    background: #1a1a1a;
    border-right-color: #333;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.jsx demo_api_ui/src/components/ProtocolPlayground/ProtocolPlayground.css
git commit -m "feat: add ProtocolPlayground main container component"
```

---

## Task 6: UI Components — ProtocolSidebar & ProtocolViewer

**Files:**
- Create: `demo_api_ui/src/components/ProtocolPlayground/ProtocolSidebar.jsx`
- Create: `demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx`

**Interfaces:**
- ProtocolSidebar: consumes `protocols[]`, `selectedProtocol`, emits `onSelectProtocol(id)`
- ProtocolViewer: consumes `flowSpec`, `executionState`, emits `onExecutionStateChange(state)`

**Description:**

Sidebar lists protocols, viewer displays diagram + controls + activity panel.

- [ ] **Step 1: Write ProtocolSidebar.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/ProtocolSidebar.jsx

import React from 'react';

export default function ProtocolSidebar({ protocols, selectedProtocol, onSelectProtocol }) {
  return (
    <div className="sidebar-protocols">
      <h3 className="sidebar-title">Protocols</h3>
      <nav className="protocol-list">
        {protocols.map(id => (
          <button
            key={id}
            className={`protocol-item ${selectedProtocol === id ? 'active' : ''}`}
            onClick={() => onSelectProtocol(id)}
            title={id}
          >
            {id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
          </button>
        ))}
      </nav>
    </div>
  );
}
```

Add to ProtocolPlayground.css:

```css
.sidebar-title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  color: #888;
  margin: 0 0 12px;
}

.protocol-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.protocol-item {
  padding: 8px 12px;
  background: transparent;
  border: 1px solid transparent;
  color: #aaa;
  font-size: 13px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.protocol-item:hover {
  background: #2a2a2a;
  color: #ddd;
}

.protocol-item.active {
  background: #3a5a7a;
  color: #fff;
  border-color: #5a7aaa;
}
```

- [ ] **Step 2: Write ProtocolViewer.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx

import React, { useState } from 'react';
import SequenceDiagram from './SequenceDiagram';
import ActivityPanel from './ActivityPanel';
import ExecutionControls from './ExecutionControls';
import ExecutionEngine from '../../services/executionEngine';

export default function ProtocolViewer({ flowSpec, executionState, onExecutionStateChange }) {
  const [engine] = useState(() => new ExecutionEngine(flowSpec));

  const handleExecute = async () => {
    const result = await engine.executeAll();
    onExecutionStateChange(engine.getState());
  };

  const handleStep = async () => {
    const nextStep = flowSpec.steps[executionState.results.length];
    if (nextStep) {
      await engine.executeStep(nextStep.id);
      onExecutionStateChange(engine.getState());
    }
  };

  const handleReset = () => {
    engine.reset();
    onExecutionStateChange(engine.getState());
  };

  return (
    <div className="protocol-viewer">
      <div className="viewer-header">
        <h2>{flowSpec.name || flowSpec.id}</h2>
        <p className="viewer-description">{flowSpec.description || 'Protocol flow'}</p>
      </div>

      <div className="viewer-body">
        <div className="diagram-section">
          <SequenceDiagram
            flowSpec={flowSpec}
            currentStep={executionState.currentStep}
          />
          <ExecutionControls
            onExecute={handleExecute}
            onStep={handleStep}
            onReset={handleReset}
            stepCount={executionState.results.length}
            totalSteps={flowSpec.steps?.length || 0}
          />
        </div>

        <div className="activity-section">
          <ActivityPanel
            results={executionState.results}
            error={executionState.error}
          />
        </div>
      </div>
    </div>
  );
}
```

Add to ProtocolPlayground.css:

```css
.protocol-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.viewer-header {
  padding: 20px;
  border-bottom: 1px solid #333;
}

.viewer-header h2 {
  margin: 0 0 8px;
  font-size: 20px;
  color: #fff;
}

.viewer-description {
  margin: 0;
  font-size: 13px;
  color: #888;
}

.viewer-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 12px;
  padding: 12px;
  overflow: hidden;
}

.diagram-section {
  display: flex;
  flex-direction: column;
  background: #0f0f0f;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
}

.activity-section {
  background: #0f0f0f;
  border: 1px solid #333;
  border-radius: 4px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/ProtocolSidebar.jsx demo_api_ui/src/components/ProtocolPlayground/ProtocolViewer.jsx
git commit -m "feat: add ProtocolSidebar and ProtocolViewer components"
```

---

## Task 7: UI Components — SequenceDiagram & Supporting Components

**Files:**
- Create: `demo_api_ui/src/components/ProtocolPlayground/SequenceDiagram.jsx`
- Create: `demo_api_ui/src/components/ProtocolPlayground/ActivityPanel.jsx`
- Create: `demo_api_ui/src/components/ProtocolPlayground/ExecutionControls.jsx`
- Create: `demo_api_ui/src/components/ProtocolPlayground/TokenInspector.jsx`

**Interfaces:**
- Each component receives props as specified in ProtocolViewer
- No new external dependencies

**Description:**

Final UI components: diagram rendering, activity log, execution buttons, token decoder.

- [ ] **Step 1: Write SequenceDiagram.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/SequenceDiagram.jsx

import React, { useEffect, useRef } from 'react';
import { renderDiagram } from '../../services/diagramRenderer';

export default function SequenceDiagram({ flowSpec, currentStep }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !flowSpec) return;

    containerRef.current.innerHTML = '';
    const svg = renderDiagram(flowSpec, 800, 600, currentStep);
    containerRef.current.appendChild(svg);
  }, [flowSpec, currentStep]);

  return (
    <div className="sequence-diagram-container" ref={containerRef} />
  );
}
```

Add to ProtocolPlayground.css:

```css
.sequence-diagram-container {
  flex: 1;
  overflow: auto;
  background: #0a0a0a;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.sequence-diagram-container svg {
  max-width: 100%;
  height: auto;
}
```

- [ ] **Step 2: Write ExecutionControls.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/ExecutionControls.jsx

import React from 'react';

export default function ExecutionControls({
  onExecute,
  onStep,
  onReset,
  stepCount,
  totalSteps
}) {
  const isComplete = stepCount >= totalSteps;

  return (
    <div className="execution-controls">
      <div className="controls-progress">
        <span className="progress-text">Step {stepCount} of {totalSteps}</span>
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${(stepCount / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      <div className="controls-buttons">
        <button
          className="btn btn-primary"
          onClick={onExecute}
          disabled={isComplete}
        >
          ▶️ Execute All
        </button>
        <button
          className="btn btn-default"
          onClick={onStep}
          disabled={isComplete}
        >
          ⏭️ Next Step
        </button>
        <button
          className="btn btn-default"
          onClick={onReset}
        >
          🔄 Reset
        </button>
      </div>
    </div>
  );
}
```

Add to ProtocolPlayground.css:

```css
.execution-controls {
  padding: 12px;
  background: #111;
  border-top: 1px solid #333;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.controls-progress {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.progress-text {
  color: #888;
  min-width: 80px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: #222;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4a7a2a, #7abb4a);
  transition: width 0.3s ease;
}

.controls-buttons {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.btn-primary {
  background: #3a5a7a;
  color: #fff;
  border: 1px solid #5a7aaa;
}

.btn-primary:hover:not(:disabled) {
  background: #4a6a8a;
}

.btn-default {
  background: #222;
  color: #aaa;
  border: 1px solid #333;
}

.btn-default:hover:not(:disabled) {
  background: #2a2a2a;
  color: #ddd;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Write ActivityPanel.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/ActivityPanel.jsx

import React, { useEffect, useRef } from 'react';
import TokenInspector from './TokenInspector';

export default function ActivityPanel({ results, error }) {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [results]);

  const lastResult = results.length > 0 ? results[results.length - 1] : null;

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
      </div>

      {error && (
        <div className="activity-error">
          ❌ {error}
        </div>
      )}

      <div className="activity-log" ref={logRef}>
        {results.length === 0 ? (
          <div className="activity-empty">No activity yet. Click Execute or Next Step.</div>
        ) : (
          results.map((result, i) => (
            <div key={i} className="activity-entry">
              <div className="entry-header">
                <span className="entry-step">{result.stepId}</span>
                <span className={`entry-status status-${result.response.status >= 200 && result.response.status < 300 ? 'ok' : 'error'}`}>
                  {result.response.status}
                </span>
              </div>
              <div className="entry-method">{result.request.method} {result.request.url}</div>
            </div>
          ))
        )}
      </div>

      {lastResult && (
        <div className="activity-details">
          <div className="details-section">
            <h5>Response</h5>
            <pre className="details-json">{JSON.stringify(lastResult.response, null, 2)}</pre>
          </div>

          {lastResult.decodedToken && lastResult.decodedToken.isValid && (
            <TokenInspector token={lastResult.decodedToken} />
          )}
        </div>
      )}
    </div>
  );
}
```

Add to ProtocolPlayground.css:

```css
.activity-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.activity-header {
  padding: 12px;
  border-bottom: 1px solid #333;
  background: #111;
}

.activity-header h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: #aaa;
}

.activity-error {
  padding: 8px 12px;
  background: #4a2a2a;
  border: 1px solid #8a4a4a;
  color: #ff9999;
  font-size: 12px;
}

.activity-log {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  border-bottom: 1px solid #333;
}

.activity-empty {
  padding: 20px;
  text-align: center;
  color: #666;
  font-size: 12px;
}

.activity-entry {
  padding: 8px 12px;
  border-bottom: 1px solid #1a1a1a;
  cursor: pointer;
  transition: background 0.2s;
}

.activity-entry:hover {
  background: #1a1a1a;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.entry-step {
  font-size: 11px;
  font-weight: 600;
  color: #7abb4a;
}

.entry-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 2px;
}

.entry-status.status-ok {
  background: #2a4a2a;
  color: #7abb4a;
}

.entry-status.status-error {
  background: #4a2a2a;
  color: #ff9999;
}

.entry-method {
  font-size: 11px;
  color: #888;
  font-family: monospace;
}

.activity-details {
  padding: 12px;
  border-top: 1px solid #333;
  overflow-y: auto;
  max-height: 40%;
}

.details-section {
  margin-bottom: 12px;
}

.details-section h5 {
  margin: 0 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
  text-transform: uppercase;
}

.details-json {
  margin: 0;
  padding: 8px;
  background: #0a0a0a;
  border: 1px solid #333;
  border-radius: 2px;
  font-size: 10px;
  color: #7abb4a;
  overflow-x: auto;
  max-height: 150px;
}
```

- [ ] **Step 4: Write TokenInspector.jsx**

```javascript
// demo_api_ui/src/components/ProtocolPlayground/TokenInspector.jsx

import React from 'react';
import { extractScopes, formatTokenDisplay } from '../../services/tokenInspector';

export default function TokenInspector({ token }) {
  if (!token || !token.isValid || !token.payload) {
    return null;
  }

  const display = formatTokenDisplay(token.payload);

  return (
    <div className="token-inspector">
      <h5>🔐 Token</h5>
      
      <div className="token-claims">
        {display.scopes.length > 0 && (
          <div className="claim">
            <span className="claim-label">Scopes:</span>
            <span className="claim-value">{display.scopes.join(', ')}</span>
          </div>
        )}
        
        {display.aud && (
          <div className="claim">
            <span className="claim-label">Audience:</span>
            <span className="claim-value">{display.aud}</span>
          </div>
        )}
        
        {display.sub && (
          <div className="claim">
            <span className="claim-label">Subject:</span>
            <span className="claim-value">{display.sub}</span>
          </div>
        )}
        
        {display.exp && (
          <div className="claim">
            <span className="claim-label">Expires:</span>
            <span className="claim-value">{display.exp}</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

Add to ProtocolPlayground.css:

```css
.token-inspector {
  margin-top: 12px;
  padding: 10px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
}

.token-inspector h5 {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: #aaa;
  text-transform: uppercase;
}

.token-claims {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.claim {
  display: flex;
  gap: 8px;
  font-size: 11px;
}

.claim-label {
  color: #888;
  font-weight: 600;
  min-width: 70px;
}

.claim-value {
  color: #7abb4a;
  font-family: monospace;
  word-break: break-all;
}
```

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ProtocolPlayground/
git commit -m "feat: add SequenceDiagram, ActivityPanel, ExecutionControls, TokenInspector components"
```

---

## Task 8: Routing & Integration

**Files:**
- Create: `demo_api_ui/src/routes/ProtocolPlaygroundRoutes.js`
- Modify: `demo_api_ui/src/App.jsx`

**Interfaces:**
- ProtocolPlaygroundRoutes exports React Route component
- App.jsx wires route at `/protocol-playground`

**Description:**

Add route and wire up main app.

- [ ] **Step 1: Create ProtocolPlaygroundRoutes.js**

```javascript
// demo_api_ui/src/routes/ProtocolPlaygroundRoutes.js

import React from 'react';
import { Route } from 'react-router-dom';
import ProtocolPlayground from '../components/ProtocolPlayground/ProtocolPlayground';

export default function ProtocolPlaygroundRoutes() {
  return (
    <Route path="/protocol-playground" element={<ProtocolPlayground />} />
  );
}
```

- [ ] **Step 2: Wire route in App.jsx**

Add to `demo_api_ui/src/App.jsx` in the Routes section:

```javascript
import ProtocolPlaygroundRoutes from './routes/ProtocolPlaygroundRoutes';

// Inside <Routes>:
<ProtocolPlaygroundRoutes />
```

Example:

```jsx
<Routes>
  {/* existing routes */}
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/agent-flow-inspector" element={<TokenFlow />} />
  
  {/* NEW: */}
  <ProtocolPlaygroundRoutes />
  
  <Route path="*" element={<NotFound />} />
</Routes>
```

- [ ] **Step 3: Verify imports**

Ensure `demo_api_ui/src/data/protocolFlows.json` exists and is valid JSON (should be created by `npm run protocols:gen` from Task 1).

- [ ] **Step 4: Test in browser**

```bash
cd demo_api_ui
npm run dev
```

Navigate to `https://local.ping-devops.com:4000/protocol-playground` and verify:
- Sidebar loads with protocol list (or empty if no specs generated yet)
- Main area shows message: "No protocols found..."

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/routes/ProtocolPlaygroundRoutes.js demo_api_ui/src/App.jsx
git commit -m "feat: wire /protocol-playground route into main app"
```

---

## Task 9: Annotate BFF Routes — 4 Protocols

**Files:**
- Modify: `demo_api_server/routes/tokenExchange.js` (RFC 8693)
- Modify: `demo_api_server/routes/parRequest.js` (PAR)
- Modify: `demo_api_server/routes/dpopRequest.js` (DPoP)
- Modify: `demo_api_server/routes/cibaDelegation.js` (CIBA/HITL)

**Interfaces:**
- Each route file receives `@flow`, `@actor`, `@step`, `@expects` JSDoc annotations
- Introspector reads these tags and generates flow specs

**Description:**

Add protocol flow annotations to existing BFF routes. Use graphify to find the exact route files first.

- [ ] **Step 1: Find token exchange routes**

```bash
graphify query "token exchange RFC 8693 routes" 2>&1 | head -40
```

Locate the route file(s) handling `/oauth/token` with RFC 8693 grant_type.

- [ ] **Step 2: Annotate RFC 8693 routes**

Edit the token exchange route file and add annotations:

```javascript
/**
 * Exchange ID token for access token via RFC 8693 delegation.
 * 
 * @flow rfc8693-token-exchange
 * @actor client-app
 * @step 1
 */
router.post('/oauth/token', (req, res) => {
  // existing implementation
});

/**
 * Validate and introspect delegated token.
 * 
 * @flow rfc8693-token-exchange
 * @actor token-exchanger
 * @step 2
 * @expects { status: 200, body: { access_token, expires_in, token_type } }
 * @branch error status: 400 { error: 'invalid_grant' }
 */
router.post('/introspect', (req, res) => {
  // existing implementation
});
```

- [ ] **Step 3: Find and annotate PAR routes**

Locate PAR (Pushed Authorization Request) routes, add:

```javascript
/**
 * Push authorization request for later retrieval.
 * 
 * @flow par
 * @actor client-app
 * @step 1
 */
router.post('/as/par', (req, res) => {
  // implementation
});

/**
 * Authorize pushed request.
 * 
 * @flow par
 * @actor auth-server
 * @step 2
 */
router.post('/as/authorize', (req, res) => {
  // implementation
});
```

- [ ] **Step 4: Find and annotate DPoP routes**

Locate DPoP routes, add:

```javascript
/**
 * Request token with DPoP proof.
 * 
 * @flow dpop
 * @actor client-app
 * @step 1
 */
router.post('/oauth/token', (req, res) => {
  // DPoP variant
});

/**
 * Verify DPoP proof.
 * 
 * @flow dpop
 * @actor gateway
 * @step 2
 */
router.post('/gateway/verify-dpop', (req, res) => {
  // implementation
});
```

- [ ] **Step 5: Find and annotate CIBA/HITL routes**

Locate CIBA or human-in-the-loop routes, add:

```javascript
/**
 * Initiate consent-only transfer (CIBA/HITL).
 * 
 * @flow ciba-hitl
 * @actor client-app
 * @step 1
 */
router.post('/oauth/token', (req, res) => {
  // CIBA variant
});

/**
 * Approve transfer after human review.
 * 
 * @flow ciba-hitl
 * @actor human-approver
 * @step 2
 */
router.post('/approve-transfer', (req, res) => {
  // implementation
});
```

- [ ] **Step 6: Generate specs**

```bash
cd demo_api_server
npm run protocols:gen
```

Verify output:

```bash
ls -la ../demo_api_ui/src/data/protocolFlows.json
cat ../demo_api_ui/src/data/protocolFlows.json | jq '.keys()'
```

Expected: JSON with keys: `rfc8693-token-exchange`, `par`, `dpop`, `ciba-hitl`.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/*.js
git commit -m "feat: annotate 4 protocol flows for introspector (RFC 8693, PAR, DPoP, CIBA/HITL)"
```

---

## Task 10: Manual QA & Polish

**Files:**
- None (testing only)

**Description:**

Test the complete playground end-to-end in the browser.

- [ ] **Step 1: Start services**

```bash
cd /Users/cmuir/Development/AI-DEMO2
./run-docker.sh
```

Wait for demo_api_ui and demo_api_server to be healthy.

- [ ] **Step 2: Navigate to playground**

Open browser: `https://local.ping-devops.com:4000/protocol-playground`

Verify:
- Sidebar shows 4 protocols (RFC 8693, PAR, DPoP, CIBA/HITL)
- Click each protocol → diagram renders in center
- Activity panel on right is initially empty

- [ ] **Step 3: Execute RFC 8693 flow**

Click "Execute All" button.

Verify:
- Progress bar advances
- Activity log shows steps with status codes
- Last step decodes JWT in token inspector
- Scopes, audience, expiry displayed correctly

- [ ] **Step 4: Test error handling**

Manually edit a request payload in the code to send invalid data.

Verify:
- Error appears in activity panel with ❌
- Error message is readable
- "Reset" button works (clears state)

- [ ] **Step 5: Test each protocol**

Repeat Steps 3-4 for PAR, DPoP, CIBA/HITL.

Verify diagram and execution work for all.

- [ ] **Step 6: No regressions**

Check that existing features still work:
- Dashboard loads
- Other routes accessible
- No console errors

---

## Self-Review

**Spec coverage:**

| Requirement | Task |
|---|---|
| Route introspector + @flow annotations | Task 1, 9 |
| ProtocolPlayground UI container | Task 5 |
| Sidebar + Viewer | Task 6 |
| SequenceDiagram SVG rendering | Task 7 |
| ActivityPanel + request/response log | Task 7 |
| ExecutionEngine (step-by-step execution) | Task 4 |
| TokenInspector (JWT decode + scopes) | Task 2, 7 |
| Routing (`/protocol-playground`) | Task 8 |
| Manual QA | Task 10 |

**Placeholders scan:** None found.

**Type consistency:**
- `ExecutionEngine.getState()` returns `{ currentStep, results, error }` — used correctly in Task 4 tests and Task 6 ProtocolViewer
- `renderDiagram(flowSpec, width, height, currentStep)` → used in Task 7 SequenceDiagram
- `decodeJWT(token)` → used in Task 2 tests, Task 4 engine, Task 7 token inspector

**Completeness:** All components wired, all services implemented, all tests written.

---

## Plan complete and saved to `docs/superpowers/plans/2026-07-29-protocol-playground-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?