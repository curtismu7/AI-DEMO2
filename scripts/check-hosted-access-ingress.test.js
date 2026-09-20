'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { verifyHostedAccess } = require('./check-hosted-access-ingress');

const root = path.resolve(__dirname, '..');

test('SE ingress and ConfigMap enforce the exact hosted access boundary', () => {
  assert.deepEqual(verifyHostedAccess({
    ingressFile: path.join(root, 'k8s/aws/se-ingress.yaml'),
    configFile: path.join(root, 'k8s/02-configmap.yaml'),
    seDeployFile: path.join(root, 'k8s/aws/deploy.sh'),
  }), []);
});
