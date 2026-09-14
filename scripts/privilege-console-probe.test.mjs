// node --test scripts/privilege-console-probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flatten, diffRecords, updateHttpBackend } from './privilege-console-probe.mjs';

test('flatten walks objects and arrays to leaf paths', () => {
  const f = flatten({ Spec: { McpAppConfig: { Backends: { Elems: ['http://localhost:8082'] } } } });
  assert.equal(f.get('Spec.McpAppConfig.Backends.Elems[0]'), 'http://localhost:8082');
});

test('diffRecords reports only differing leaves', () => {
  const rows = diffRecords({ a: 1, same: 'x' }, { a: 2, same: 'x' });
  assert.deepEqual(rows, [{ path: 'a', a: 1, b: 2 }]);
});

test('diffRecords marks a key present on only one side as absent', () => {
  // The point of the whole tool: a working app carries a field the broken one lacks.
  const rows = diffRecords({ Status: { Tools: ['x'] } }, {});
  assert.deepEqual(rows, [{ path: 'Status.Tools[0]', a: 'x', b: '(absent)' }]);
});

test('updateHttpBackend changes only HttpAppConfig.Backends', () => {
  const app = {
    ObjectMeta: { Name: 'langchainagent', RevisionID: 7 },
    Spec: {
      AppType: 'http',
      HttpAppConfig: {
        Backends: { Elems: ['http://old.internal:8888'] },
        MeshCluster: 'ai-demo-cmuir',
        EntryPath: '/langchain-agent',
      },
    },
  };
  const updated = updateHttpBackend(
    app,
    'http://langchain-agent.ping-devops-cmuir.svc.cluster.local:8888/',
  );

  assert.equal(app.Spec.HttpAppConfig.Backends.Elems[0], 'http://old.internal:8888');
  assert.equal(
    updated.Spec.HttpAppConfig.Backends.Elems[0],
    'http://langchain-agent.ping-devops-cmuir.svc.cluster.local:8888',
  );
  assert.deepEqual(diffRecords(app, updated), [
    {
      path: 'Spec.HttpAppConfig.Backends.Elems[0]',
      a: 'http://old.internal:8888',
      b: 'http://langchain-agent.ping-devops-cmuir.svc.cluster.local:8888',
    },
  ]);
});

test('updateHttpBackend refuses non-HTTP and non-HTTP-app targets', () => {
  assert.throws(() => updateHttpBackend({ Spec: { HttpAppConfig: {} } }, 'file:///tmp/x'), /http or https/);
  assert.throws(() => updateHttpBackend({ Spec: { McpAppConfig: {} } }, 'https://example.test'), /HttpAppConfig/);
});
