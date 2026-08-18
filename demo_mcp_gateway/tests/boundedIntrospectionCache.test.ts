'use strict';

/**
 * boundedIntrospectionCache.test.ts — introspection-cache unbounded-growth
 * regression.
 *
 * The introspection cache had no size cap and no sweep: expired entries were
 * only skipped on `get`, never deleted, so every distinct inbound token (they
 * rotate per login/exchange; garbage tokens' {active:false} results cached too)
 * was a permanent map entry. It is now routed through the same
 * cacheInsertWithEviction pattern the exchange cache uses (HI-06), with expired
 * entries pruned on access. This test exercises the eviction helper against the
 * introspection cache's `{ result, expiresAt }` value shape, and confirms the
 * client's live-token hit/expiry semantics are unchanged.
 */

import axios from 'axios';
import { cacheInsertWithEviction } from '../src/boundedTokenCache';
import { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

type IntrospValue = { result: { active: boolean }; expiresAt: number };

describe('cacheInsertWithEviction — introspection value shape', () => {
  it('bounds the map size and FIFO-evicts the oldest entry over the cap', () => {
    const cache = new Map<string, IntrospValue>();
    const MAX = 3;
    const future = Date.now() + 60_000;

    for (const k of ['a', 'b', 'c']) {
      cacheInsertWithEviction(cache, k, { result: { active: true }, expiresAt: future }, MAX);
    }
    expect(cache.size).toBe(3);

    // Inserting a 4th (all live) evicts the oldest insertion, 'a'.
    cacheInsertWithEviction(cache, 'd', { result: { active: true }, expiresAt: future }, MAX);
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('removes expired entries on overflow rather than only skipping them', () => {
    const cache = new Map<string, IntrospValue>();
    const MAX = 3;
    const past = Date.now() - 1;
    const future = Date.now() + 60_000;

    cache.set('stale1', { result: { active: false }, expiresAt: past });
    cache.set('stale2', { result: { active: false }, expiresAt: past });
    cache.set('live', { result: { active: true }, expiresAt: future });

    // At cap: the sweep deletes the two expired entries (freeing room) instead
    // of FIFO-evicting the live one.
    cacheInsertWithEviction(cache, 'new', { result: { active: true }, expiresAt: future }, MAX);

    expect(cache.has('stale1')).toBe(false);
    expect(cache.has('stale2')).toBe(false);
    expect(cache.has('live')).toBe(true);
    expect(cache.has('new')).toBe(true);
  });
});

describe('GatewayIntrospectionClient — cache hit/expiry semantics preserved', () => {
  const config = {
    introspectionEndpoint: 'https://auth.example/introspect',
    clientId: 'gw',
    clientSecret: 'secret',
    tokenEndpointAuthMethod: 'basic',
  } as unknown as GatewayConfig;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    GatewayIntrospectionClient.clearCache();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('serves a live token from cache, then re-fetches once its entry has expired', async () => {
    mockedAxios.post.mockResolvedValue({ data: { active: true, sub: 'u1' } } as never);
    const client = new GatewayIntrospectionClient(config);

    expect((await client.introspect('tok-live')).active).toBe(true);
    expect((await client.introspect('tok-live')).active).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1); // second served from cache

    // Advance past the dev TTL (30s): the expired entry is pruned on access and
    // the token is re-introspected.
    jest.advanceTimersByTime(31_000);
    expect((await client.introspect('tok-live')).active).toBe(true);
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
