import { readFileSync } from 'node:fs';
import path from 'node:path';

// The first page load must stay at a few dozen asset requests: the hosted ingress caps concurrent connections per visitor
// and answers 503 beyond it, which left the page on its loading splash. These settings merge the entry's static graph into
// a few files. Dropping strictExecutionOrder breaks module initialization order in the merged files (a blank page with
// "t is not a function"), so it is guarded together with the groups.
const config = readFileSync(path.resolve(__dirname, '../../vite.config.js'), 'utf8');

describe('vite chunking for the first page load', () => {
  it('merges the entry graph into a few files, vendor code apart from app code', () => {
    expect(config).toMatch(/codeSplitting:\s*\{/);
    expect(config).toMatch(/name:\s*'vendor-initial'[^}]*tags:\s*\['\$initial'\]/);
    expect(config).toMatch(/name:\s*'app-initial'[^}]*tags:\s*\['\$initial'\]/);
  });

  it('keeps strict execution order so the merged files initialize in import order', () => {
    expect(config).toMatch(/strictExecutionOrder:\s*true/);
  });
});
