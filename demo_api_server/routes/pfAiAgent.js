'use strict';

const crypto = require('crypto');
const express = require('express');
const configStore = require('../services/configStore');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const {
  getFeatureStatus,
  resolveCimdConfig,
} = require('../services/pfAiAgentFeatureConfig');
const { metadataDocument, beginCimd, completeCimd } = require('../services/pfAiAgentCimdService');
const { exchangeForThirdPartyAccessToken, cimdPingFederateToken } = require('../services/pfAiAgentCrossDomainExchangeService');

const hasUsablePfToken = (req) => Boolean(cimdPingFederateToken(req));
const { redeemIdJag } = require('../services/pfAiAgentMockThirdPartyService');
const { beginRar, completeRar, userLimits } = require('../services/pfAiAgentRarService');
const { startCiba, pollCiba, mockDecideCiba } = require('../services/pfAiAgentCibaService');
const cibaWebApprover = require('../services/pfAiAgentCibaWebApproverService');
const pfTokenExchangeDemo = require('../services/pfTokenExchangeDemoService');

function sessionProvider(req) {
  return String(req.session?.oauthProvider || req.session?.user?.oauthProvider || '').toLowerCase();
}

function requireApplicationSession(req, res, next) {
  if (!req.session?.oauthTokens?.accessToken || !['pingone', 'pingfederate'].includes(sessionProvider(req))) {
    return res.status(401).json({ error: 'application_session_required' });
  }
  return next();
}

function saveSession(req, callback) {
  if (typeof req.session?.save !== 'function') return callback();
  req.session.save((error) => callback(error));
}

function errorCode(error, fallback) {
  return /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : fallback;
}

function createPfAiAgentRouter({ configStore: store = configStore, fetchImpl = fetch, dataStore } = {}) {
  const router = express.Router();

  /**
   * After the user has signed in and approved, read the outcome: accepted or denied, the token
   * type, and the redacted trace of every hop. rarResult is null until the run completes.
   *
   * @flow rar-pf
   * @title Read the result
   * @actor pingfederate
   * @to client-app
   * @step 2
   */
  router.get('/status', (req, res) => {
    res.json({
      sessionProvider: sessionProvider(req) || 'none',
      features: getFeatureStatus(store),
      nativeIdJagPath: '/pingfederate-id-jag/demo',
      // True once this session has signed in at PingFederate through the CIMD flow and holds a usable PF token.
      pfSignedIn: hasUsablePfToken(req),
      // Safe metadata of this session's last RAR run (outcome, token type, DPoP key thumbprint);
      // never a token, code, verifier or key.
      rarResult: req.session?.pfAiAgent?.rarResult || null,
      // The same for the last CIMD sign-in: redacted request/response trace and who signed in.
      cimdResult: req.session?.pfAiAgent?.cimdResult || null,
    });
  });

  router.get('/cimd/client-metadata.json', (req, res) => {
    try {
      if (!getFeatureStatus(store).cimd) return res.status(404).json({ error: 'pf_ai_cimd_not_enabled' });
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(metadataDocument(resolveCimdConfig(store)));
    } catch (error) {
      return res.status(error.httpStatus || 503).json({ error: errorCode(error, 'pf_ai_cimd_config_invalid') });
    }
  });

  router.get('/cimd/start', requireApplicationSession, async (req, res) => {
    try {
      const { redirectUrl } = await beginCimd(req, { store, fetchImpl });
      return res.redirect(302, redirectUrl);
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_cimd_start_failed') });
    }
  });

  router.get('/cimd/callback', async (req, res) => {
    const featureSession = req.session?.pfAiAgent;
    const pendingTypes = ['cimd', 'rar'].filter((type) => Boolean(featureSession?.[`${type}Pending`]));
    if (pendingTypes.length !== 1) {
      const suffix = pendingTypes.length ? '?cimd=error&rar=error' : '?cimd=error';
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent${suffix}`);
    }
    const flow = pendingTypes[0];
    try {
      let result;
      if (flow === 'cimd') result = await completeCimd(req, { store, fetchImpl });
      else result = await completeRar(req, { store, fetchImpl });
      const status = flow === 'rar' && result.outcome === 'denied' ? 'denied' : 'success';
      return saveSession(req, (error) => {
        if (error) return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=error`);
        return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=${status}`);
      });
    } catch {
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=error`);
    }
  });

  /**
   * The client trades its PingFederate access token for an ID-JAG that PingFederate signs
   * (the issuer is PingFederate's own), checks the assertion, then redeems it at the
   * third-party authorization server for an access token scoped to that domain. One call runs
   * both hops; the response is the redacted trace of each, with the ID-JAG claims decoded.
   *
   * @flow xaa-pf
   * @name XAA / ID-JAG (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/draft-looker-app-driven-authorization-16 App-Driven AuthZ
   * @why XAA / ID-JAG covers cross-domain delegation: a client with an identity in its home domain exchanges its token for an ID-JAG assertion the target domain's authorization server accepts, with no shared user store and no second login. Here the home domain is PingFederate, so the assertion's issuer is PingFederate and its signature is checked against PingFederate's published key.
   * @example Airline status getting you into a partner lounge: the partner does not have you in its member database; it accepts an assertion from your airline and issues its own lounge pass.
   * @ai An agent working across two companies' APIs gets a per-domain token in each, every one traceable to the same home identity that delegated the task.
   * @title Get a PingFederate ID-JAG and redeem it
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {"subjectProvider":"pingfederate"}
   */
  router.post('/cross-domain/exchange', requireApplicationSession, async (req, res) => {
    try {
      const result = await exchangeForThirdPartyAccessToken(req, {
        subjectProvider: req.body?.subjectProvider,
        store,
        fetchImpl,
      });
      return res.json(result);
    } catch (error) {
      const code = errorCode(error, 'pf_ai_cross_domain_exchange_failed');
      return res.status(error.httpStatus || 502).json({
        error: code,
        // Our own sentence naming the token's header fields (alg, kid, typ); never token content.
        ...(code === 'PF_AI_ID_JAG_UNSUPPORTED' ? { detail: error.message } : {}),
      });
    }
  });

  const exchangeReply = (hop) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await hop(req, { store }));
    } catch (error) {
      const code = errorCode(error, 'pf_ai_exchange_failed');
      return res.status(error.httpStatus || 502).json({
        error: code,
        // These codes carry our own fixed sentence telling the user what to change; never token content.
        ...(String(code).startsWith('PF_AI_EXCHANGE_') ? { detail: error.message } : {}),
      });
    }
  };

  /**
   * First exchange: the signed-in user's PingFederate token plus the AI agent's own actor token
   * go to PingFederate, which returns a token for the agent gateway. The sub is still the user;
   * act names the agent. The response carries the new token's claims, never the token.
   *
   * @flow rfc8693-token-exchange-pf
   * @name RFC 8693 Token Exchange (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/rfc8693 RFC 8693
   * @why Token Exchange (RFC 8693) trades one token for another at the authorization server: a narrower audience, narrower scope, and an act claim recording who is acting on whose behalf. Here PingFederate runs two hops, user to agent and agent to MCP service, and the final token carries a nested act chain naming both actors. Needs a PingFederate sign-in.
   * @example A valet key: starts the car, will not open the trunk. Each downstream call gets a token minted for exactly that call, so a compromised service holds a token good for almost nothing.
   * @ai Every agent hop is a fresh exchange, so the token that reaches a tool server is scoped to that one call, and the nested act chain is a record of every delegation.
   * @title Exchange the user token for an agent token
   * @actor client-app
   * @to pingfederate
   * @step 1
   */
  router.post('/token-exchange/agent', requireApplicationSession, exchangeReply(pfTokenExchangeDemo.agentHop));

  /**
   * Second exchange: the agent token plus the MCP service's actor token go to PingFederate,
   * which returns the token the MCP server accepts. The act claim is now nested: the MCP
   * service acting for the agent acting for the user.
   *
   * @flow rfc8693-token-exchange-pf
   * @title Exchange the agent token for an MCP token
   * @actor client-app
   * @to pingfederate
   * @step 2
   */
  router.post('/token-exchange/mcp', requireApplicationSession, exchangeReply(pfTokenExchangeDemo.mcpHop));

  // Called by the PingFederate banking_transaction processor after sign-in, not
  // by a browser: it has no session, so it presents a shared credential.
  router.get('/rar/user-limits', (req, res) => {
    const expected = String(store.getEffective('pf_ai_rar_lookup_secret') || '');
    const presented = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer /, ''));
    if (!expected || presented.length !== Buffer.byteLength(expected)
      || !crypto.timingSafeEqual(presented, Buffer.from(expected))) {
      return res.status(401).json({ error: 'pf_ai_rar_lookup_unauthorized' });
    }
    const limits = userLimits(req.query.username, dataStore);
    if (!limits) return res.status(404).json({ error: 'pf_ai_rar_user_unknown' });
    res.set('Cache-Control', 'no-store');
    return res.json(limits);
  });

  // A stand-in third-party authorization server for the cross-domain demo: redeems the
  // PingFederate ID-JAG at the JWT-bearer grant. Not for browsers; the BFF's own exchange
  // calls it. Answers 404 unless pf_ai_third_party_mock_enabled is true.
  router.post('/mock-third-party/token', async (req, res) => {
    const result = await redeemIdJag({ body: req.body || {}, headers: req.headers, store, fetchImpl });
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    if (result.challenge) res.set('WWW-Authenticate', 'Basic realm="mock-third-party"');
    return res.status(result.status).json(result.body);
  });

  // CIBA: ask a named user to approve on their PingOne MFA device, then poll. Responses carry the
  // state and safe metadata only, never the auth_req_id, a token or the client secret.
  /**
   * Start a CIBA approval request for the signed-in user at PingFederate. The client names
   * the user and a binding message; PingFederate asks that user to approve on their own device.
   *
   * @flow ciba-hitl-pf
   * @name CIBA / HITL (PingFederate)
   * @idp pingfederate
   * @rfc https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html OpenID CIBA 1.0
   * @why CIBA decouples approval from the device where a request started: the client asks the authorization server to authenticate a user, and the user approves on their own device with no browser redirect. This is the PingFederate run of the flow; it needs a PingFederate sign-in, and with the mock phone enabled no PingFederate call is made at all.
   * @ai An AI agent has no browser and no human beside it. CIBA is how it asks the account owner for explicit approval of a specific action and stays blocked until a person answers.
   * @title Start the approval request
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {"bindingMessage":"Approve $500 transfer"}
   */
  router.post('/ciba/start', requireApplicationSession, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await startCiba(req, {
        loginHint: req.body?.loginHint, bindingMessage: req.body?.bindingMessage, store, fetchImpl,
      }));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  });

  /**
   * Poll the request. Returns pending until the approver answers, then approved or denied
   * with safe metadata only (subject, issuer, scope); never the auth_req_id or a token.
   *
   * @flow ciba-hitl-pf
   * @title Poll the result
   * @actor client-app
   * @to pingfederate
   * @step 3
   */
  router.get('/ciba/status', requireApplicationSession, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await pollCiba(req, { store, fetchImpl }));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  });

  // The mock phone's Approve / Deny; 404 unless PF_AI_CIBA_MOCK_ENABLED is true.
  /**
   * The approver answers. Only the mock phone can be answered from here; with a real device the
   * user taps Approve there, and this step answers 404 (pf_ai_ciba_mock_disabled).
   *
   * @flow ciba-hitl-pf
   * @title Approve on the mock phone
   * @actor human-approver
   * @to client-app
   * @step 2
   * @body {"decision":"approve"}
   */
  router.post('/ciba/mock-decision', requireApplicationSession, (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(mockDecideCiba(req, req.body?.decision, { store }));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  });

  // Web approver: the PingFederate stand-in authenticator registers and polls with a shared secret
  // (no session); the page answers through /decision. All 404 unless PF_AI_CIBA_WEB_APPROVER_ENABLED.
  const approverReply = (res, action) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(action());
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  };
  router.post('/ciba/web-approver/requests', (req, res) => approverReply(res,
    () => cibaWebApprover.register({ headers: req.headers, body: req.body, store })));
  router.get('/ciba/web-approver/requests/:transactionId', (req, res) => approverReply(res,
    () => cibaWebApprover.lookup({ headers: req.headers, transactionId: req.params.transactionId, store })));
  router.post('/ciba/web-approver/decision', requireApplicationSession, (req, res) => approverReply(res,
    () => cibaWebApprover.decide(req, req.body?.decision, { store })));

  /**
   * Push the request with its authorization_details (RAR, RFC 9396) over PAR and get back the
   * URL the user opens to sign in and approve. Send {"format":"json"} to receive that URL and
   * the redacted trace as JSON; without it the answer is the 302 the app's own page follows.
   * Open authorizeUrl in a browser tab, sign in and approve, then run step 2.
   *
   * @flow rar-pf
   * @name RAR (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/rfc9396 RFC 9396
   * @why RAR (Rich Authorization Requests) lets a client ask for one precise action instead of a broad scope: a banking_transaction detail naming the accounts, the amount and the currency. PingFederate checks that detail against policy while the user signs in, and the token that comes back covers only what was approved. The request is pushed over PAR first, so the details never travel in a browser URL.
   * @example An agent asks to move $125 from checking to savings. PingFederate compares the amount and accounts with the user's limits; an out-of-policy request is refused before any token exists.
   * @ai An agent should hold authority for the one action it was asked to do, not a standing scope. RAR is how that action is written down and enforced at the authorization server.
   * @title Push the request and get the sign-in URL
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {"scenario":"allowed","format":"json"}
   */
  router.post('/rar/start', requireApplicationSession, async (req, res) => {
    const json = req.body?.format === 'json';
    try {
      const { redirectUrl, trace } = await beginRar(req, {
        scenario: req.body?.scenario || 'allowed',
        userKey: req.body?.userKey,
        dpop: ['1', 'true', 'on'].includes(String(req.body?.dpop || '').toLowerCase()),
        store,
        dataStore,
        fetchImpl,
      });
      if (json) {
        res.set('Cache-Control', 'no-store');
        return saveSession(req, (error) => (error
          ? res.status(500).json({ error: 'pf_ai_rar_session_save_failed' })
          : res.json({ authorizeUrl: redirectUrl, trace })));
      }
      return res.redirect(302, redirectUrl);
    } catch (error) {
      if (json) return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_rar_failed') });
      const result = error.code === 'PF_AI_RAR_POLICY_REJECTED' ? 'denied' : 'error';
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?rar=${result}`);
    }
  });

  // Protocol Playground starts: the authorize URL and the redacted trace as JSON instead of a 302,
  // then a reader for the outcome once the user has signed in in a browser tab. The same
  // pending-flow machinery as /rar/start and /cimd/start, so the callback and its checks are shared.
  const startJson = (begin) => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      const { redirectUrl, trace } = await begin(req);
      return saveSession(req, (error) => (error
        ? res.status(500).json({ error: 'pf_ai_session_save_failed' })
        : res.json({ authorizeUrl: redirectUrl, trace })));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_start_failed') });
    }
  };
  const resultJson = (read) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    return res.json(read(req.session?.pfAiAgent) || { state: 'none' });
  };
  const beginPlain = (req, extra) => beginRar(req, {
    scenario: 'allowed', userKey: req.body?.userKey, store, dataStore, fetchImpl, ...extra,
  });

  /**
   * Push the authorization request to PingFederate over PAR and get back the sign-in URL. The
   * browser URL carries only the client and a one-time request_uri; the parameters travelled
   * server to server. Open authorizeUrl in a browser tab, sign in, then run step 2.
   *
   * @flow par-pf
   * @name PAR (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/rfc9126 RFC 9126
   * @why PAR (Pushed Authorization Requests) moves the authorization request out of the browser URL: the client POSTs its parameters to the authorization server directly and gets back a one-time request_uri to put in the redirect. Nothing in the URL can be tampered with, and the request is authenticated before the user sees anything. This is a real push to PingFederate's PAR endpoint.
   * @example Instead of writing your order on a postcard anyone can read or alter on the way, you hand it to the clerk and carry only a ticket number.
   * @ai An agent's request for access can be sealed and checked at the server before any human is asked to approve it, so a tampered or forged request never reaches the approval screen.
   * @title Push the request and get the sign-in URL
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {}
   */
  router.post('/par/start', requireApplicationSession, startJson((req) => beginPlain(req, { authorizationDetails: false })));

  /**
   * After the user has signed in and approved, read the outcome: the code exchange result and the
   * redacted trace of each hop. state is none until a run completes.
   *
   * @flow par-pf
   * @title Read the result
   * @actor pingfederate
   * @to client-app
   * @step 2
   */
  router.get('/par/result', requireApplicationSession, resultJson((s) => s?.rarResult));

  /**
   * Start an authorization-code sign-in at PingFederate with PKCE: the client keeps a random
   * verifier, sends only its SHA-256 challenge, and later proves it holds the verifier when it
   * redeems the code. Open authorizeUrl in a browser tab, sign in, then run step 2.
   *
   * @flow pkce-pf
   * @name PKCE (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/rfc7636 RFC 7636
   * @why PKCE (Proof Key for Code Exchange) stops a stolen authorization code from being useful: the client invents a random secret, sends only its hash with the authorization request, and must present the original secret to redeem the code. This is a real PKCE sign-in at PingFederate, using a client identified by a metadata document URL.
   * @example A coat-check ticket with a torn corner: only the person holding the matching half can collect the coat, even if someone else picks up the ticket.
   * @ai Agents and apps that cannot keep a client secret still get a code flow that is safe to run: an intercepted code is worthless without the verifier that never left the client.
   * @title Start the sign-in with a code challenge
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {}
   */
  router.post('/pkce/start', requireApplicationSession, startJson((req) => beginCimd(req, { store, fetchImpl })));

  /**
   * After the user has signed in, read the outcome: who PingFederate says signed in and the
   * redacted trace including the code redemption with the verifier. state is none until done.
   *
   * @flow pkce-pf
   * @title Read the result
   * @actor pingfederate
   * @to client-app
   * @step 2
   */
  router.get('/pkce/result', requireApplicationSession, resultJson((s) => s?.cimdResult));

  /**
   * Start the same request with DPoP: the client generates a fresh key pair, PingFederate is
   * told to require DPoP for this client, and the access token that comes back is bound to the
   * public key's thumbprint. Open authorizeUrl in a browser tab, sign in, then run step 2.
   *
   * @flow dpop-pf
   * @name DPoP (PingFederate)
   * @idp pingfederate
   * @rfc https://datatracker.ietf.org/doc/html/rfc9449 RFC 9449
   * @why DPoP (Demonstrating Proof of Possession) fixes the bearer-token problem: a plain bearer token is like cash, whoever holds it can spend it. DPoP binds the access token to a private key the client keeps, and every use must carry a fresh signed proof. Here PingFederate requires DPoP for the client and returns a token of type DPoP bound to the key's thumbprint.
   * @example An access token leaks through a logging pipeline or a compromised proxy. Against a DPoP-protected API the replay fails: the attacker has the token but cannot produce the signed proof, because the private key never left the legitimate client.
   * @ai Agent tokens pass through many hands: queues, tool servers, traces, logs. Sender-constraining them means an exfiltrated token from any of those hops cannot be replayed by whoever finds it.
   * @title Start the sign-in with a DPoP key
   * @actor client-app
   * @to pingfederate
   * @step 1
   * @body {}
   */
  router.post('/dpop/start', requireApplicationSession, startJson((req) => beginPlain(req, { dpop: true })));

  /**
   * After the user has signed in and approved, read the outcome: the token type (DPoP) and the
   * public key thumbprint the token is bound to. state is none until a run completes.
   *
   * @flow dpop-pf
   * @title Read the result
   * @actor pingfederate
   * @to client-app
   * @step 2
   */
  router.get('/dpop/result', requireApplicationSession, resultJson((s) => s?.rarResult));

  return router;
}

module.exports = createPfAiAgentRouter();
module.exports.createPfAiAgentRouter = createPfAiAgentRouter;
