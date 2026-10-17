'use strict';
// Unit checks for the pure policy builder: node scripts/pingfederate/enable-pf-passwordless.test.js
const assert = require('node:assert');
const { withPasswordlessBranch, withoutPasswordlessBranch, hasPasswordlessBranch } = require('./enable-pf-passwordless.js');

const src = (id) => ({ type: 'IDP_ADAPTER', sourceRef: { id } });
const done = (context) => ({ action: { type: 'DONE', context }, children: [] });
const pw = (context) => ({ action: { type: 'AUTHN_SOURCE', context, authenticationSource: src('aiDemoPfHtmlForm') }, children: [done('Fail'), done('Success')] });
const live = {
  failIfNoSelection: false,
  trackedHttpParameters: ['acr_values'],
  authnSelectionTrees: [{
    name: 'Password, plus PingOne MFA for acr_values=Multi_Factor',
    enabled: true,
    rootNode: { action: { type: 'AUTHN_SELECTOR', authenticationSelectorRef: { id: 'aiDemoPfAcrSelector' } }, children: [pw('Multi_Factor'), pw('No Match'), pw('Not in Request')] },
  }],
};

const next = withPasswordlessBranch(live);
const kids = next.authnSelectionTrees[0].rootNode.children;
assert.deepStrictEqual(kids.map((c) => c.action.context), ['mfa_only', 'Multi_Factor', 'No Match', 'Not in Request'], 'adds mfa_only, keeps the others in order');
assert.deepStrictEqual(kids.slice(1), live.authnSelectionTrees[0].rootNode.children, 'existing branches copied unchanged');
const branch = kids[0];
assert.strictEqual(branch.action.authenticationSource.sourceRef.id, 'aiDemoPfIdFirst', 'identifier first runs first');
const mfa = branch.children.find((c) => c.action.context === 'Success');
assert.strictEqual(mfa.action.authenticationSource.sourceRef.id, 'aiDemoPfP1Mfa', 'then the PingOne MFA adapter');
assert.deepStrictEqual(mfa.action.inputUserIdMapping, { source: { type: 'ADAPTER', id: 'aiDemoPfIdFirst' }, value: 'subject' }, 'MFA gets the identified subject');
assert.deepStrictEqual(branch.children[0], done('Fail'), 'PF requires Fail before Success');
assert.strictEqual(live.authnSelectionTrees[0].rootNode.children.length, 3, 'input policy is not mutated');
assert.deepStrictEqual(withPasswordlessBranch(next).authnSelectionTrees[0].rootNode.children.map((c) => c.action.context), ['mfa_only', 'Multi_Factor', 'No Match', 'Not in Request'], 'idempotent: re-applying does not duplicate the branch');
assert.throws(() => withPasswordlessBranch({ authnSelectionTrees: [] }), /run enable-pf-mfa-step-up/, 'refuses without the acr selector tree');
assert.strictEqual(hasPasswordlessBranch(live), false, 'detects a before policy');
assert.strictEqual(hasPasswordlessBranch(next), true, 'detects an after policy');
assert.deepStrictEqual(withoutPasswordlessBranch(next), live, 'removing the branch gives back the exact before policy');
const interim = withoutPasswordlessBranch(next, { asPassword: true }).authnSelectionTrees[0].rootNode.children;
assert.deepStrictEqual(interim.map((c) => c.action.context), ['mfa_only', 'Multi_Factor', 'No Match', 'Not in Request'], 'interim revert keeps an mfa_only branch for PF');
assert.strictEqual(interim[0].action.authenticationSource.sourceRef.id, 'aiDemoPfHtmlForm', 'interim mfa_only branch is the password form');
console.log('enable-pf-passwordless: all checks passed');
