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

  it('covers every tool the router knows about', () => {
    const { tools } = buildToolSchemas();
    for (const name of ['get_my_accounts', 'create_transfer', 'get_investment_balance',
                        'special_offers', 'user_profile_card', 'show_mortgage',
                        'demo_show_accounts', 'sequential_think']) {
      expect(tools[name]).toBeDefined();
    }
  });
});
