const { readFileSync } = require('fs');
const { join } = require('path');

describe('rfc8693TokenExchangeService narration', () => {
  const src = readFileSync(
    join(__dirname, '../../../services/rfc8693TokenExchangeService.js'),
    'utf8',
  );
  it('imports teachLogger', () => {
    expect(src).toMatch(/require\(['"]\.\.\/utils\/teachLogger['"]\)/);
  });
  it('narrates the RFC 8693 request and response steps', () => {
    expect(src).toMatch(/teachLog\.step\([^)]*RFC 8693[^)]*REQUEST/i);
    expect(src).toMatch(/teachLog\.step\([^)]*RFC 8693[^)]*RESPONSE/i);
  });
  it('narrates the claims delta', () => {
    expect(src).toMatch(/claims delta/i);
  });
});
