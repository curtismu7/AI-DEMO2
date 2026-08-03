'use strict';
import * as fs from 'fs';
import * as path from 'path';
import { buildToolSchemas } from '../scripts/genToolSchemas';

describe('mcp-tool-schemas.json drift', () => {
  it('committed artifact matches a fresh regeneration (run: npm run gen:tool-schemas)', () => {
    const artifactPath = path.resolve(__dirname, '../../mcp-tool-schemas.json');
    const committed = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    expect(committed).toEqual(buildToolSchemas());
  });

  // IG reads its own copy at /var/gateway/config/mcp-tool-schemas.json, which comes
  // from the ping-gateway/config DIRECTORY mount (a per-file mount of the root
  // artifact dangles whenever git replaces it — REGRESSION_PLAN §4). Byte-identical,
  // not just deep-equal: both are written by the same generator run.
  it('ping-gateway copy is byte-identical to the root artifact', () => {
    const rootPath = path.resolve(__dirname, '../../mcp-tool-schemas.json');
    const gatewayPath = path.resolve(__dirname, '../../ping-gateway/config/mcp-tool-schemas.json');
    expect(fs.readFileSync(gatewayPath, 'utf-8')).toEqual(fs.readFileSync(rootPath, 'utf-8'));
  });

  it('covers every tool the router knows about', () => {
    const { tools } = buildToolSchemas();
    for (const name of ['get_my_accounts', 'create_transfer', 'get_investment_balance',
                        'special_offers', 'user_profile_card', 'show_mortgage',
                        'demo_show_accounts', 'sequential_think']) {
      expect(tools[name]).toBeDefined();
    }
  });
});
