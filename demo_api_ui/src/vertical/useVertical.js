import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { VerticalContext } from './VerticalProvider';

// Frozen module constant, not a fresh literal per call. Nearly nothing renders
// without the Provider, but when something does (an isolated unit test, a
// component mounted outside the tree) it should not be the one path that still
// churns a new object every render.
const NO_PROVIDER = Object.freeze({
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
});

export function useVertical() {
  const ctx = useContext(VerticalContext);
  const location = useLocation();

  // Derived ahead of the memo, and a boolean rather than the raw pathname, so
  // the memo re-runs on a route change that actually crosses the /admin
  // boundary and not on every other navigation.
  const isAdminScope = Boolean(ctx && ctx.isAdmin && location.pathname.startsWith('/admin'));

  // VerticalProvider memoizes its own context value, so useContext returns the
  // same `ctx` across an unrelated ancestor re-render. That fix bought nothing
  // while this hook rebuilt a new object on every call: almost no consumer reads
  // the raw context, they nearly all come through here, so a React.memo'd
  // consumer or a useEffect deps array keyed on this output still saw a new
  // reference every render. Memoizing here is what makes the Provider-level
  // memo reach them.
  //
  // ctx and isAdminScope are the complete dependency set: every field below is
  // read off one or derived from both.
  return useMemo(() => {
    if (!ctx) return NO_PROVIDER;
    return {
      activeId: ctx.activeId,
      pageManifest: ctx.pageManifest,
      pageMockData: ctx.pageMockData,
      adminManifest: ctx.adminManifest,
      agentManifest: isAdminScope ? ctx.adminManifest : ctx.pageManifest,
      isAdminScope,
      isAdmin: ctx.isAdmin,
      // 'loading' | 'resolved' | 'failed'. A hydrated state without the field
      // (older setState shape) counts as concluded.
      verticalStatus: ctx.verticalStatus || 'resolved',
      refetch: ctx.refetch,
    };
  }, [ctx, isAdminScope]);
}
