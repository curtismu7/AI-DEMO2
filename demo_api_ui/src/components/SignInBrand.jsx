import { useContext } from 'react';
import { VerticalContext } from '../vertical/VerticalProvider';

/**
 * The vertical's logo and name above a sign-in-style form — the same block
 * PiFlowSignInModal shows. Reads the context directly (not useVertical()) so it
 * works for signed-out visitors and above the Router.
 */
export default function SignInBrand() {
  const identity = useContext(VerticalContext)?.pageManifest?.identity;
  const brandName = identity?.headerTitle || identity?.displayName || '';
  if (!identity?.logoPath && !brandName) return null;
  return (
    <div className="pi-flow-signin__brand">
      {identity?.logoPath ? (
        <img className="pi-flow-signin__logo" src={identity.logoPath} alt={identity.logoAlt || ''} />
      ) : null}
      {brandName ? <span className="pi-flow-signin__brand-name">{brandName}</span> : null}
    </div>
  );
}
