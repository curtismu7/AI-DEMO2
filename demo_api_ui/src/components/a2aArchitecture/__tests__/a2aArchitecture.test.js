import fs from 'node:fs';
import path from 'node:path';
import { DELEGATION_SOURCE } from '../a2aArchitectureData';

// The page's sequence source must equal the .mmd file users paste into Lucid. The docs write "#" as "#35;"
// (real Mermaid cuts text at "#"); the page's FlowDiagram does not decode it, so compare after decoding.
const docs = path.resolve(__dirname, '../../../../../docs');

describe('A2A page sequence matches docs/a2a-delegation-sequence.mmd', () => {
  it('is identical', () => {
    const mmd = fs.readFileSync(path.join(docs, 'a2a-delegation-sequence.mmd'), 'utf8').replaceAll('#35;', '#');
    expect(DELEGATION_SOURCE).toBe(mmd);
  });
});
