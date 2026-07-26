// demo_api_server/src/__tests__/actorParRedirectUris.test.js
'use strict';

/**
 * Regression: live intent-binding PAR failed with par_push_failed / Redirect URI
 * mismatch when PUBLIC_APP_URL was local.ping-devops.com but the AI Agent Actor
 * app only had api.ping.demo registered. Provision must register every known
 * public host (same set as admin/user OAuth apps).
 */
const {
  listActorPlaceholderRedirectUris,
  getActorPlaceholderRedirectUri,
  ACTOR_PLACEHOLDER_CALLBACK_PATH,
  KNOWN_PUBLIC_ORIGINS,
} = require('../../services/oauthRedirectUris');

describe('listActorPlaceholderRedirectUris', () => {
  it('includes local.ping-devops, api.ping.demo, and ai-demo hosts', () => {
    const uris = listActorPlaceholderRedirectUris('https://local.ping-devops.com:4000');
    expect(uris).toEqual(expect.arrayContaining([
      `https://local.ping-devops.com:4000${ACTOR_PLACEHOLDER_CALLBACK_PATH}`,
      `https://api.ping.demo:4000${ACTOR_PLACEHOLDER_CALLBACK_PATH}`,
      `https://ai-demo.ping-devops.com${ACTOR_PLACEHOLDER_CALLBACK_PATH}`,
    ]));
    expect(KNOWN_PUBLIC_ORIGINS).toHaveLength(3);
  });

  it('dedupes when publicAppUrl already matches a known origin', () => {
    const uris = listActorPlaceholderRedirectUris('https://api.ping.demo:4000/');
    const apiHits = uris.filter((u) => u.includes('api.ping.demo'));
    expect(apiHits).toHaveLength(1);
  });
});

describe('getActorPlaceholderRedirectUri', () => {
  const configStore = require('../../services/configStore');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers pingone_ai_agent_actor_redirect_uri override', () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'pingone_ai_agent_actor_redirect_uri') {
        return 'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback';
      }
      if (key === 'public_app_url') return 'https://local.ping-devops.com:4000';
      return '';
    });
    expect(getActorPlaceholderRedirectUri()).toBe(
      'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
    );
  });

  it('falls back to public_app_url placeholder path', () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'public_app_url') return 'https://local.ping-devops.com:4000';
      return '';
    });
    expect(getActorPlaceholderRedirectUri()).toBe(
      'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
    );
  });
});

describe('listActorParRedirectCandidates', () => {
  const { listActorParRedirectCandidates } = require('../../services/oauthRedirectUris');
  const configStore = require('../../services/configStore');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('puts preferred PUBLIC_APP_URL first, then remaining known hosts', () => {
    jest.spyOn(configStore, 'getEffective').mockImplementation((key) => {
      if (key === 'public_app_url') return 'https://local.ping-devops.com:4000';
      return '';
    });
    const candidates = listActorParRedirectCandidates();
    expect(candidates[0]).toContain('local.ping-devops.com');
    expect(candidates).toEqual(expect.arrayContaining([
      expect.stringContaining('api.ping.demo'),
      expect.stringContaining('ai-demo.ping-devops.com'),
    ]));
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe('UC14b PAR redirect — step-verification ledger', () => {
  const { writeLedgerEntry, readLedger } = require('../../services/stepVerificationLedger');

  it('records unit-par-redirect PASS when both demo hosts are registered', () => {
    const uris = listActorPlaceholderRedirectUris('https://local.ping-devops.com:4000');
    expect(uris).toEqual(expect.arrayContaining([
      'https://local.ping-devops.com:4000/api/auth/oauth/ai-agent-placeholder-callback',
      'https://api.ping.demo:4000/api/auth/oauth/ai-agent-placeholder-callback',
    ]));

    writeLedgerEntry({
      vertical: 'banking',
      useCaseId: 'UC14b',
      triggerType: 'link',
      mode: 'unit-par-redirect',
      status: 'PASS',
      errorClass: null,
      primaryTool: 'create_transfer',
      checkedAt: new Date().toISOString(),
      verifiedBy: 'src/__tests__/actorParRedirectUris.test.js',
    });

    const rows = readLedger('banking').filter(
      (e) => e.useCaseId === 'UC14b' && e.mode === 'unit-par-redirect',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PASS');
  });
});
