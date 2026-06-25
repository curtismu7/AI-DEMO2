'use strict';
const path = require('path');
const fs = require('fs');

const FRAG_PATH = path.join(__dirname, '../../config/oas/pingone-fragment.json');

test('fragment file exists', () => {
  expect(fs.existsSync(FRAG_PATH)).toBe(true);
});

describe('OAS fragment structure', () => {
  let spec;
  beforeAll(() => { spec = JSON.parse(fs.readFileSync(FRAG_PATH, 'utf8')); });

  test('is OAS 3.1', () => { expect(spec.openapi).toBe('3.1.0'); });

  test('has info object', () => {
    expect(spec.info).toMatchObject({ title: expect.any(String), version: expect.any(String) });
  });

  test('has at least 5 path operations', () => {
    const ops = Object.values(spec.paths || {}).flatMap(p =>
      ['get', 'post', 'put', 'patch', 'delete'].filter(m => p[m])
    );
    expect(ops.length).toBeGreaterThanOrEqual(5);
  });

  test('all operations have x-permission and x-public-api annotations', () => {
    for (const pathItem of Object.values(spec.paths || {})) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (!pathItem[method]) continue;
        expect(pathItem[method]['x-permission']).toBeDefined();
        expect(pathItem[method]['x-public-api']).toBeDefined();
      }
    }
  });

  test('has bearerAuth securityScheme', () => {
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
  });
});
