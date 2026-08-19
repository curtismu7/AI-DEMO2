import { useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { VerticalContext } from './VerticalProvider';

export function useVertical() {
  const ctx = useContext(VerticalContext);
  const location = useLocation();

  if (!ctx) {
    return {
      pageManifest: null,
      agentManifest: null,
      adminManifest: null,
      pageMockData: null,
      activeId: null,
      isAdminScope: false,
      isAdmin: false,
      // No provider = nothing will ever resolve this; report 'loading' so
      // consumers keep their bounded-wait fallback rather than concluding
      // "no vertical" instantly.
      verticalStatus: 'loading',
      refetch: () => {},
    };
  }

  const isAdminScope = ctx.isAdmin && location.pathname.startsWith('/admin');
  const agentManifest = isAdminScope ? ctx.adminManifest : ctx.pageManifest;

  return {
    activeId: ctx.activeId,
    pageManifest: ctx.pageManifest,
    pageMockData: ctx.pageMockData,
    adminManifest: ctx.adminManifest,
    agentManifest,
    isAdminScope,
    isAdmin: ctx.isAdmin,
    // 'loading' | 'resolved' | 'failed'. A hydrated state without the field
    // (older setState shape) counts as concluded.
    verticalStatus: ctx.verticalStatus || 'resolved',
    refetch: ctx.refetch,
  };
}
