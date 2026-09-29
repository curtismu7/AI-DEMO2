'use strict';
const { configureDoor, postGateway, readIntegrationConfig, withRelayServer } = require('./support');
const { runGatewayChecks } = require('./gatewayChecks');

const AUTH_RETURN_TO = '/integration/auth-complete';

function assertInteractiveTerminal(isTTY = process.stdin.isTTY) {
  if (!isTTY) {
    throw new Error('Interactive Gateway sign-in requires a TTY; use test:integration with AI_GATEWAY_TEST_TOKEN instead.');
  }
}

async function waitForAuthenticatedSession(baseUrl, {
  fetchImpl = fetch,
  timeoutMs = 120000,
  intervalMs = 500,
  now = Date.now,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
} = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const signal = AbortSignal.timeout(Math.max(1, deadline - now()));
    try {
      const response = await fetchImpl(`${baseUrl}/api/gateway/state`, { signal });
      if (response.ok) {
        const state = await response.json();
        if (state?.oauth?.authenticated === true) return;
      }
    } catch {
      if (signal.aborted) {
        throw new Error('Timed out waiting for Gateway sign-in. Finish sign-in in the browser and retry.');
      }
      throw new Error('Could not check local Gateway sign-in status.');
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error('Timed out waiting for Gateway sign-in. Finish sign-in in the browser and retry.');
    }
    await sleep(Math.min(intervalMs, remaining));
  }
}

async function promptForSignIn(authUrl, { output = process.stdout } = {}) {
  output.write(`Open this Gateway authorization URL in your browser:\n${authUrl}\n`);
  output.write('Complete sign-in in the browser. Waiting up to two minutes for the callback.\n');
}

async function signInInteractively({ baseUrl, fixture, getAccessToken, prompt = promptForSignIn } = {}) {
  const configured = await configureDoor(baseUrl, fixture.allowed.url);
  if (!configured.ok) throw new Error('Could not configure the allowed Gateway door. Check the integration fixture.');

  const response = await postGateway(baseUrl, '/auth/start', null, { returnTo: AUTH_RETURN_TO });
  if (!response.ok) throw new Error('Could not start Gateway authorization. Check staging connectivity and the integration fixture.');
  let authData;
  try {
    authData = await response.json();
  } catch {
    throw new Error('Gateway authorization returned an unreadable response.');
  }
  if (typeof authData.authUrl !== 'string' || !authData.authUrl) {
    throw new Error('Gateway authorization response did not include a sign-in URL.');
  }

  await prompt(authData.authUrl);
  await waitForAuthenticatedSession(baseUrl);

  const token = getAccessToken?.();
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Gateway sign-in completed without an access token in the relay session.');
  }
  return token;
}

async function runInteractiveIntegration({
  isTTY = process.stdin.isTTY,
  readConfig = readIntegrationConfig,
  startRelay = withRelayServer,
  prompt = promptForSignIn,
  runChecks = runGatewayChecks,
} = {}) {
  assertInteractiveTerminal(isTTY);
  const { fixture } = readConfig({ requireToken: false });
  await startRelay(async (baseUrl, { getAccessToken }) => {
    const token = await signInInteractively({ baseUrl, fixture, getAccessToken, prompt });
    await runChecks({ baseUrl, fixture, token });
  });
}

if (require.main === module) {
  runInteractiveIntegration().then(() => {
    process.stdout.write('Live Gateway integration checks passed.\n');
  }).catch(() => {
    // Unexpected network/parser exceptions may contain credentials or bodies.
    process.stderr.write('Interactive live Gateway integration failed. Check the TTY, fixture, browser sign-in, and staging connectivity.\n');
    process.exitCode = 1;
  });
}

module.exports = {
  promptForSignIn,
  assertInteractiveTerminal,
  waitForAuthenticatedSession,
  signInInteractively,
  runInteractiveIntegration,
};
