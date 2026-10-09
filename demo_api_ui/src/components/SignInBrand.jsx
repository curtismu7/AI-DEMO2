import { useContext, useEffect, useState } from 'react';
import { VerticalContext } from '../vertical/VerticalProvider';

/**
 * The sign-in hero bar: the vertical's logo, its all-caps brand label
 * (identity.brandCaps) and its full name, on the vertical's header gradient —
 * the format every sign-in surface shares (pi.flow modal, forgot-password,
 * profile, agent access, the dashboard). Reads the context directly (not
 * useVertical()) so it works for signed-out visitors and above the Router.
 *
 * A lockup logo (wider than tall — it carries its own wordmark) suppresses the
 * text half: "UNITED" printed twice reads as a bug. Only glyph/lettermark tiles
 * get the caps + name beside them.
 */
export default function SignInBrand({ welcome }) {
  const identity = useContext(VerticalContext)?.pageManifest?.identity;
  const brandName = identity?.headerTitle || identity?.displayName || '';
  // Lockup detection needs the loaded image's aspect; until then assume glyph.
  const [logoIsLockup, setLogoIsLockup] = useState(false);
  useEffect(() => {
    setLogoIsLockup(false);
    if (!identity?.logoPath) return undefined;
    const img = new Image();
    img.onload = () => setLogoIsLockup(img.naturalWidth > img.naturalHeight * 1.6);
    img.src = identity.logoPath;
    return () => {
      img.onload = null;
    };
  }, [identity?.logoPath]);
  const showText = Boolean(welcome || brandName) && !(identity?.logoPath && logoIsLockup);
  // welcome: the modal always shows a hero (the welcome line carries it even
  // with no vertical); without it, a no-brand vertical renders nothing.
  if (!welcome && !identity?.logoPath && !brandName) return null;
  return (
    <div className={welcome ? 'pi-flow-signin__hero' : 'pi-flow-signin__brand'}>
      {identity?.logoPath ? (
        <img className="pi-flow-signin__logo" src={identity.logoPath} alt={identity.logoAlt || ''} />
      ) : null}
      {showText ? (
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
      ) : null}
    </div>
  );
}
