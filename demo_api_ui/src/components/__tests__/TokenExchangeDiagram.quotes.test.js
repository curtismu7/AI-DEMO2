// demo_api_ui/src/components/__tests__/TokenExchangeDiagram.quotes.test.js
//
// Mermaid node labels are "…"-delimited. A claim value carrying a literal "
// closes the label early and the whole Diagram tab dies with
// "Parse error on line 7 … got 'STR'". aud is the usual offender: it arrives
// as an array and stringifies to ["enduser.ping.demo"].
import { describe, it, expect } from 'vitest';
import { buildDiagramSource } from '../TokenExchangeDiagram';

const traceWithAud = (aud) => ({
  startedAt: 1,
  tokenEvents: [
    {
      id: 'user-token',
      claims: { sub: 'curtis', iss: 'https://auth.pingone.com', aud, scope: 'openid profile' },
    },
  ],
});

const steps = [{ id: 'signin', status: 'done' }];

describe('buildDiagramSource — mermaid label quoting', () => {
  it('does not leak a raw double quote from an array aud', () => {
    const src = buildDiagramSource(traceWithAud(['enduser.ping.demo']), steps);

    expect(src).toContain("['enduser.ping.demo']");
    expect(src).not.toContain('["enduser.ping.demo"]');
  });

  it('leaves no " inside a label body — only the [" and "] delimiters', () => {
    const src = buildDiagramSource(traceWithAud(['enduser.ping.demo', 'mcp-server']), steps);
    const withoutDelimiters = src.replace(/\["/g, '').replace(/"\]/g, '');

    expect(withoutDelimiters).not.toContain('"');
  });
});
