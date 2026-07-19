// Ping product registry for A8 attribution.
// 4 products, SVG-dot chips, no emoji.

export const PING_PRODUCTS = {
  idp:   { id: 'idp',   label: 'PingOne',           cssClass: 'pp--idp'   },
  mfa:   { id: 'mfa',   label: 'PingOne MFA',        cssClass: 'pp--mfa'   },
  gw:    { id: 'gw',    label: 'PingGateway',        cssClass: 'pp--gw'    },
  authz: { id: 'authz', label: 'PingOne Authorize',  cssClass: 'pp--authz' },
  privilege: { id: 'privilege', label: 'PingOne Privilege', cssClass: 'pp--privilege' },
};

// Step-id -> product id. Both runtime event IDs and catalog evidence slugs included.
// Unmapped IDs return null (no chip -- silently ignored, forward-compatible).
const STEP_MAP = {
  // PingOne (IDP) -- issuance, exchange, JWKS, may_act, DPoP, RAR, TraT
  'user-token':                    'idp',
  'id-token':                      'idp',
  'refresh-token':                 'idp',
  'user-token-introspection':      'idp',
  'user-token-refreshed':          'idp',
  'user-scopes-insufficient':      'idp',
  'exchange':                      'idp',
  'exchange-in-progress':          'idp',
  'exchange-required':             'idp',
  'exchange-skipped':              'idp',
  'exchange-failed':               'idp',
  'exchanged-token':               'idp',
  'exchanged-token-verified':      'idp',
  'agent-actor-token':             'idp',
  'agent-actor-token-unavailable': 'idp',
  'two-ex-agent-actor':            'idp',
  'two-ex-agent-actor-acquiring':  'idp',
  'two-ex-agent-actor-verified':   'idp',
  'two-ex-exchange1-in-progress':  'idp',
  'two-ex-exchange1':              'idp',
  'two-ex-exchange1-verified':     'idp',
  'two-ex-mcp-actor':              'idp',
  'two-ex-mcp-actor-acquiring':    'idp',
  'two-ex-mcp-actor-verified':     'idp',
  'two-ex-exchange2-in-progress':  'idp',
  'two-ex-final-token':            'idp',
  'two-ex-final-token-verified':   'idp',
  'two-ex-config-invalid':         'idp',
  'subject-preservation-mismatch': 'idp',
  'admin-token-detected':          'idp',
  'admin-token-substituted':       'idp',
  'admin-token-not-found':         'idp',
  'may-act-injected':              'idp',
  'may-act-required-block':        'idp',
  'scopes-injected':               'idp',
  'audience-injected':             'idp',
  'dpop-binding':                  'idp',
  'rar-authorization':             'idp',
  'trat-context':                  'idp',
  'mcp-step9-exchange':            'idp',
  'scope-upgrade':                 'idp',
  'scope-upgrade-failed':          'idp',
  'token-exchange':                'idp', // catalog slug
  'ciba-poll':                     'idp', // catalog slug
  'a2a-exchange':                  'idp', // catalog slug
  'a2a-exchange1':                 'idp',
  'a2a-exchange2':                 'idp',
  'a2a-exchange-failed':           'idp',
  'a2a-agent1-actor':              'idp',
  'a2a-agent2-actor':              'idp',
  'token-refresh':                 'idp',
  'sim-exchange-ok':               'idp', // attack-sim: PingOne minted the deficient token
  'sim-replay-start':              'idp', // attack-sim: the replayed user token
  // PingOne MFA -- step-up challenges
  'mfa-challenge':                 'mfa', // catalog slug
  // PingGateway -- gateway enforcement
  'gw-introspection':              'gw',
  'gw-mtls':                      'gw',
  'mcp-tool-invoked':              'gw',
  'mcp-gateway-route':             'gw',
  'resource-server-reply':         'gw',
  'mcp-tool-result':               'gw',
  'tool-error':                    'gw',
  'tool-call-failed':              'gw',
  'tool-call-success':             'gw',
  'tool-dispatched':               'gw', // catalog slug
  'sim-gateway-deny':              'gw', // attack-sim: gateway rejected the call
  // PingOne Authorize -- policy decisions
  'gw-authorize':                  'authz',
  'authorize-decision':            'authz', // catalog slug
  // tool-hitl defaults to authz; productForEvent refines by challengeType
  'tool-hitl':                     'authz',
};

/**
 * Map a step id to a PING_PRODUCTS entry, or null if not mapped.
 * @param {string} stepId
 * @returns {{ id: string, label: string, cssClass: string } | null}
 */
export function productForStep(stepId) {
  const productId = STEP_MAP[stepId];
  return productId ? PING_PRODUCTS[productId] : null;
}

/**
 * Map a live token event object to a product.
 * Refines tool-hitl: if challengeType === 'step_up', returns MFA; otherwise Authorize.
 * @param {{ id: string, challengeType?: string } | null | undefined} event
 * @returns {{ id: string, label: string, cssClass: string } | null}
 */
export function productForEvent(event) {
  if (!event?.id) return null;
  if (event.id === 'tool-hitl') {
    return event.challengeType === 'step_up' ? PING_PRODUCTS.mfa : PING_PRODUCTS.authz;
  }
  return productForStep(event.id);
}

/**
 * Derive the deduplicated ordered set of Ping products a use case exercises,
 * from its evidence.tokenChain step IDs.
 * Order is fixed: idp -> mfa -> gw -> authz (product registry declaration order).
 * @param {{ evidence?: { tokenChain?: string[] } }} uc
 * @returns {Array<{ id: string, label: string, cssClass: string }>}
 */
export function productsForUseCase(uc) {
  const chain = uc?.evidence?.tokenChain ?? [];
  const seen = new Set();
  for (const stepId of chain) {
    const p = productForStep(stepId);
    if (p) seen.add(p.id);
  }
  return Object.values(PING_PRODUCTS).filter((p) => seen.has(p.id));
}
