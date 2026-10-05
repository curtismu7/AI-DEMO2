import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePrivilegeA2aProfile } from '../usePrivilegeA2aProfile';
import { loadPrivilegeA2aProfile, profileLabel } from '../../../utils/privilegeA2aProfile';
import apiClient from '../../../services/apiClient';

vi.mock('../../../services/apiClient', () => ({ default: { get: vi.fn() } }));
const vertical = vi.hoisted(() => ({ activeId: 'banking' }));
vi.mock('../../../vertical/useVertical', () => ({ useVertical: () => vertical }));

const profileFor = (id) => ({ vertical: id, agentName: `${id} agent`, specialistName: `${id} specialist`, questions: ['a', 'b', 'c'] });

beforeEach(() => {
  vertical.activeId = 'banking';
  apiClient.get.mockReset();
});

describe('usePrivilegeA2aProfile', () => {
  it('returns the profile from the BFF', async () => {
    apiClient.get.mockResolvedValue({ data: { profile: profileFor('banking') } });
    const { result } = renderHook(() => usePrivilegeA2aProfile());
    await waitFor(() => expect(result.current).toEqual(profileFor('banking')));
    expect(apiClient.get).toHaveBeenCalledWith('/api/privilege-a2a/profile');
  });

  it('is null when the vertical has no specialist', async () => {
    apiClient.get.mockResolvedValue({ data: { profile: null } });
    const { result } = renderHook(() => usePrivilegeA2aProfile());
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('treats 401 or any failure as null', async () => {
    apiClient.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), { response: { status: 401 } }));
    expect(await loadPrivilegeA2aProfile()).toBeNull();
    const { result } = renderHook(() => usePrivilegeA2aProfile());
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });

  it('refetches when the active vertical changes and never shows the old vertical profile', async () => {
    apiClient.get.mockImplementation(() => Promise.resolve({ data: { profile: profileFor(vertical.activeId) } }));
    const { result, rerender } = renderHook(() => usePrivilegeA2aProfile());
    await waitFor(() => expect(result.current?.vertical).toBe('banking'));
    vertical.activeId = 'healthcare';
    rerender();
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.vertical).toBe('healthcare'));
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});

describe('profileLabel', () => {
  it('maps the real actor keys to the vertical names; unknown keys and no profile give undefined', () => {
    const p = { agentName: 'CareConnect agent', specialistName: 'Records Specialist' };
    expect(profileLabel(p, 'main')).toBe('CareConnect agent');
    expect(profileLabel(p, 'analyst')).toBe('Records Specialist');
    expect(profileLabel(p, 'refunds')).toBe('Records Specialist');
    expect(profileLabel(p, 'mcp')).toBe('Records Specialist data tools');
    expect(profileLabel(p, 'restricted')).toBe('Ungranted Records Specialist');
    expect(profileLabel(p, 'langchainagent')).toBeUndefined();
    expect(profileLabel(null, 'main')).toBeUndefined();
  });
});
