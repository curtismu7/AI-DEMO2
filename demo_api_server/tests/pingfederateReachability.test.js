const net = require('net');
const { isPingFederateDown } = require('../services/pingfederateReachability');

describe('isPingFederateDown', () => {
  it('is true when the port refuses connections', async () => {
    const srv = net.createServer().listen(0);
    const { port } = srv.address();
    await new Promise((r) => srv.close(r));
    await expect(isPingFederateDown(`https://127.0.0.1:${port}/as/token.oauth2`)).resolves.toBe(true);
  });

  it('is false when something is listening', async () => {
    const srv = net.createServer((s) => s.destroy()).listen(0);
    await expect(isPingFederateDown(`https://127.0.0.1:${srv.address().port}/x`)).resolves.toBe(false);
    await new Promise((r) => srv.close(r));
  });

  it('fails open when the endpoint is unset or unparseable', async () => {
    await expect(isPingFederateDown(undefined)).resolves.toBe(false);
    await expect(isPingFederateDown('not a url')).resolves.toBe(false);
  });
});
