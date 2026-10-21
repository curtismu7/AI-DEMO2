// The 12 steps of "how a chat client (ChatGPT, Claude) gets access to a protected MCP server", derived from the leg
// trace the BFF records (services/connectorSandbox.js). A step is done only when every leg it names was recorded —
// nothing is marked done on the strength of the script alone.

const STEPS = [
  { title: 'Protected tool request', legs: ['1a', '1b'] },
  { title: 'Discover protected resource', legs: ['2a', '2b'] },
  { title: 'Discover OAuth configuration', legs: ['3a', '3b'] },
  { title: 'Begin browser authorization', legs: ['4a', '4b'] },
  { title: 'Retrieve client metadata (CIMD)', legs: ['5a', '5b'] },
  { title: 'IdP sign-in and consent', legs: ['6a', '6b', '6c', '6d'] },
  { title: 'Authorization-code exchange', legs: ['7a'] },
  { title: 'Verify client and issue token', legs: ['8a', '8b', '8c'] },
  { title: 'Gateway validates access token', legs: ['9a'] },
  { title: 'Fine-grained policy decision (P1AZ)', legs: ['10a', '10b'] },
  { title: 'Call the downstream API', legs: ['11a', '11b'] },
  { title: 'Return authorized result', legs: ['12a'] },
];

const short = (v, n = 70) => {
  const text = typeof v === 'string' ? v : JSON.stringify(v);
  return text && text.length > n ? `${text.slice(0, n)}…` : text || '';
};

function summarize(n, trace, run) {
  const t = (id) => trace[id];
  switch (n) {
    case 1: return t('1b') ? `${t('1b').response.status} challenge, no token sent` : '';
    case 2: return t('2b') ? `resource ${short(t('2b').response.body.resource, 44)}, scope ${(t('2b').response.body.scopes_supported || []).join(' ')}` : '';
    case 3: return t('3b') ? `PKCE ${t('3b').response.body.code_challenge_methods_supported.join(',')} · CIMD ${t('3b').response.body.client_id_metadata_document_supported ? 'supported' : 'no'} · client auth ${t('3b').response.body.token_endpoint_auth_methods_supported.join(',')}` : '';
    case 4: return t('4b') ? 'browser sent /authorize with client_id URL, PKCE S256, resource, state' : '';
    case 5: return t('5b') ? (t('5b').response.status === 200 ? `${t('5b').response.body.client_name}: ${t('5b').response.body.token_endpoint_auth_method}` : 'client document rejected') : '';
    case 6: return t('6d') ? (run.status === 'denied' ? 'member denied consent' : `consent ${run.consent?.consentId || ''} v${run.consent?.version || ''} recorded, code returned to ChatGPT`) : t('6a') ? 'waiting for the member to approve or deny' : '';
    case 7: return t('7a') ? 'POST /token with code, PKCE verifier and a signed client assertion' : '';
    case 8: return t('8c') ? (t('8c').response.status === 200 ? 'assertion verified against the client JWKS; audience-bound token issued' : short(t('8c').response.body.error_description)) : '';
    case 9: return t('12a') || t('9a') ? (t('12a')?.response.status === 401 ? short(t('12a').response.body.error_description) : 'token validated: signature, issuer, audience, expiry, scope, member, consent') : '';
    case 10: return t('10b') ? t('10b').response.decision : '';
    case 11: return t('11b') ? 'benefits API called' : t('10b') ? 'not called' : '';
    case 12: return t('12a') ? (t('12a').response.status === 200 ? 'authorized result returned' : `refused (${t('12a').response.status})`) : '';
    default: return '';
  }
}

/** @returns {{n:number,title:string,legs:string[],status:'pending'|'done'|'error',summary:string,detail:object}[]} */
export function buildConnectorSteps({ run = null } = {}) {
  const trace = run?.trace || {};
  const gatewayStatus = trace['12a']?.response?.status;
  const refusedAt = gatewayStatus && gatewayStatus !== 200 ? (trace['10b'] ? 10 : 9) : null;

  return STEPS.map((step, i) => {
    const n = i + 1;
    const recorded = step.legs.every((id) => trace[id]);
    let status = recorded ? 'done' : 'pending';
    if (n === 6 && run?.status === 'denied') status = 'error';
    if (n === 8 && trace['8c'] && trace['8c'].response.status !== 200) status = 'error';
    if (refusedAt === n) status = 'error';
    if (n === 12 && gatewayStatus && gatewayStatus !== 200) status = 'error';
    // The downstream API leg exists only after a Permit; a Deny leaves it pending by design.
    const detail = Object.fromEntries(step.legs.filter((id) => trace[id]).map((id) => [id, trace[id]]));
    return { n, title: step.title, legs: step.legs, status, summary: summarize(n, trace, run || {}), detail: Object.keys(detail).length ? detail : null };
  });
}
