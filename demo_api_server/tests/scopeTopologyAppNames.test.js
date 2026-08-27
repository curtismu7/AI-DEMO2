'use strict';

/**
 * scope-topology.json keys apps by their LOGICAL name ("Super Banking
 * Investment Advisor Agent") while PingOne knows them by their provisioned
 * DISPLAY name ("Demo AI App - Investment Advisor Agent"). The mapping between
 * the two already lives in the manifest at provisioning.appNames.
 *
 * Nothing exposed that mapping in the app direction, so a caller holding a
 * PingOne name could not reach the declared expectation — it silently got an
 * empty array, indistinguishable from "this app declares no scopes". That is
 * what made every identity in the agent registry read as unverified.
 *
 * This is the app-side mirror of provisionedResourceName(), which has done the
 * same job for resources since the manifest was written.
 */

const scopeTopology = require('../services/scopeTopology');

describe('scopeTopology.topologyAppName', () => {
  test('maps a provisioned PingOne display name back to its topology name', () => {
    expect(scopeTopology.topologyAppName('Demo AI App - Investment Advisor Agent'))
      .toBe('Super Banking Investment Advisor Agent');
    expect(scopeTopology.topologyAppName('Demo AI App - AI Agent Actor'))
      .toBe('Super Banking AI Agent');
  });

  test('passes an unmapped name through unchanged', () => {
    // A caller may already hold the topology name, and an app that predates the
    // mapping must not resolve to undefined.
    expect(scopeTopology.topologyAppName('Super Banking User App'))
      .toBe('Super Banking User App');
    expect(scopeTopology.topologyAppName('Something Nobody Provisioned'))
      .toBe('Something Nobody Provisioned');
  });

  test('tolerates a missing argument rather than throwing', () => {
    expect(scopeTopology.topologyAppName(undefined)).toBeUndefined();
    expect(scopeTopology.topologyAppName(null)).toBeNull();
  });

  test('reaches the real declared scopes through the mapping', () => {
    // The end-to-end point: the display name must land on a NON-empty
    // expectation, because an empty one is what the registry reads as
    // "never compared".
    const viaDisplay = scopeTopology.appGrantedScopes(
      scopeTopology.topologyAppName('Demo AI App - Records Specialist Agent'),
    );
    expect(viaDisplay.length).toBeGreaterThan(0);

    // …and the untranslated name reaches nothing, which is the bug.
    expect(scopeTopology.appGrantedScopes('Demo AI App - Records Specialist Agent'))
      .toEqual([]);
  });
});
