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

// The Diagram tab was dark-only and rendered into a white panel body, so the
// connectors and their edge labels were drawn pale-on-white and vanished.
// These pin the two things that fix has to keep true: the palette actually
// changes with the mode, and two-argument callers still get the dark ramp.
describe('buildDiagramSource — light / dark palette', () => {
  const trace = traceWithAud(['enduser.ping.demo']);

  it('emits the light ramp when dark is false', () => {
    const src = buildDiagramSource(trace, steps, false);

    expect(src).toContain('fill:#eff6ff');   // user node, light
    expect(src).not.toContain('fill:#0c2040'); // user node, dark
  });

  it('emits the dark ramp when dark is true', () => {
    const src = buildDiagramSource(trace, steps, true);

    expect(src).toContain('fill:#0c2040');
    expect(src).not.toContain('fill:#eff6ff');
  });

  it('defaults to the dark ramp so existing two-argument callers are unchanged', () => {
    expect(buildDiagramSource(trace, steps)).toBe(buildDiagramSource(trace, steps, true));
  });

  it('themes the idle placeholder too — it is what an unrun demo shows', () => {
    const idleLight = buildDiagramSource(null, [], false);
    const idleDark = buildDiagramSource(null, [], true);

    expect(idleLight).toContain('fill:#f8fafc');
    expect(idleDark).toContain('fill:#0d1117');
  });
});
