import { useContext } from 'react';
import { VerticalContext } from '../vertical/VerticalProvider';

/**
 * The sign-in hero bar: the vertical's logo, its all-caps brand label
 * (identity.brandCaps) and its full name, on the vertical's header gradient —
 * the format every sign-in surface shares (pi.flow modal, forgot-password,
 * profile, agent access). Reads the context directly (not useVertical()) so it
 * works for signed-out visitors and above the Router.
 */
export default function SignInBrand({ welcome }) {
  const identity = useContext(VerticalContext)?.pageManifest?.identity;
  const brandName = identity?.headerTitle || identity?.displayName || '';
  // welcome: the modal always shows a hero (the welcome line carries it even
  // with no vertical); without it, a no-brand vertical renders nothing.
  if (!welcome && !identity?.logoPath && !brandName) return null;
  return (
    <div className={welcome ? 'pi-flow-signin__hero' : 'pi-flow-signin__brand'}>
      {identity?.logoPath ? (
        <img className="pi-flow-signin__logo" src={identity.logoPath} alt={identity.logoAlt || ''} />
      ) : null}
      <div className={welcome ? 'pi-flow-signin__hero-text' : undefined}>
        {welcome ? <p className="pi-flow-signin__welcome">{welcome}</p> : null}
        {brandName ? (
          <p className="pi-flow-signin__brand-name">
            {identity?.brandCaps ? (
              <span className="pi-flow-signin__brand-caps">{identity.brandCaps}</span>
            ) : null}
            {brandName}
          </p>
        ) : null}
      </div>
    </div>
  );
}
