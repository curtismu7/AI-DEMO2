import { useEffect } from "react";

/* -------------------------------------------------------------------------- *
 *  NeuralSpinner — "token ingress" loading indicator
 * -------------------------------------------------------------------------- *
 *  Eight spectrum-coloured tokens fall down their synapses into a pulsing core
 *  that flashes as it absorbs each one, while a full-spectrum comet sweeps the
 *  rim and counter-rotating attention ticks scan behind it.
 *
 *  The token spectrum is fixed — it is the identity you recognise app-wide.
 *  The accent is owned by the stylesheet (`--ns-accent`, defaulting to the
 *  themeable --brand-navy) rather than passed in: REGRESSION_PLAN.md H3 bans
 *  inline colour because it beats every [data-theme] override. Per-request
 *  colour variation still reads on the card's top border, which SpinnerHost
 *  drives from spinnerService's SPINNER_COLORS.
 *
 *  Everything is a ratio of --ns-size except the ring hairlines, so one
 *  component covers the overlay and inline use. Below ~40px the tokens stop
 *  being legible; InlineSpinner still owns anything smaller.
 *
 *  Props
 *  -----
 *  size       number  diameter in px                                     (96)
 *  className  string  extra class on the root for positioning           ("")
 * -------------------------------------------------------------------------- */

const STYLE_ID = "neural-spinner-styles";

/** Hue per token, walked around the wheel so no two neighbours collide. */
const TOKEN_HUES = [198, 238, 272, 310, 340, 22, 44, 160];

const CSS = `
.ns {
  --ns-size: 96px;
  --ns-accent: var(--spinner-accent, var(--brand-navy, #1d4ed8));
  --ns-dot: calc(var(--ns-size) * .075);
  --ns-dim: color-mix(in srgb, var(--ns-accent) 30%, transparent);
  position: relative;
  width: var(--ns-size); height: var(--ns-size);
  display: grid; place-items: center;
  flex-shrink: 0;
}

/* ambient field — the neuron sits in a lit volume, not on a flat plane */
.ns::before {
  content: ''; position: absolute; inset: -22%; border-radius: 50%;
  background: radial-gradient(circle,
    color-mix(in srgb, var(--ns-accent) 22%, transparent) 0%,
    transparent 66%);
  animation: ns-breathe 3.6s ease-in-out infinite;
}

/* rainbow sweep — a full-spectrum comet chasing the accent head */
.ns-sweep {
  position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 0deg,
    transparent 0deg 96deg,
    rgba(96,165,250,.32) 150deg,
    rgba(192,132,252,.55) 208deg,
    rgba(244,114,182,.72) 258deg,
    rgba(251,191,36,.86) 300deg,
    var(--ns-accent) 342deg,
    #fff 356deg,
    transparent 360deg);
  -webkit-mask: radial-gradient(closest-side, transparent 0 87%, #000 89%);
          mask: radial-gradient(closest-side, transparent 0 87%, #000 89%);
  filter: drop-shadow(0 0 5px color-mix(in srgb, var(--ns-accent) 55%, transparent));
  animation: ns-spin 2.2s linear infinite;
}

/* attention ticks — counter-rotating gauge marks, reads as "heads scanning" */
.ns-ticks {
  position: absolute; inset: 11%; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg,
    var(--ns-dim) 0deg 1.4deg, transparent 1.4deg 15deg);
  -webkit-mask: radial-gradient(closest-side, transparent 0 83%, #000 85%);
          mask: radial-gradient(closest-side, transparent 0 83%, #000 85%);
  animation: ns-spin 8s linear infinite reverse;
}

/* token spokes — eight coloured tokens fall inward and are absorbed */
.ns-spoke { position: absolute; inset: 0; transform: rotate(calc(var(--i) * 45deg)); }

/* the synapse the token travels down */
.ns-spoke::after {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: 34%; height: 1px; transform-origin: 0 50%;
  background: linear-gradient(90deg, hsl(var(--h) 90% 62% / .42), transparent);
  animation: ns-wire 2.2s ease-in-out infinite;
  animation-delay: calc(var(--i) * -.275s);
}

/* the token itself */
.ns-spoke::before {
  content: ''; position: absolute; top: 50%; left: 50%;
  width: var(--ns-dot); height: var(--ns-dot);
  margin: calc(var(--ns-dot) / -2) 0 0 calc(var(--ns-dot) / -2);
  border-radius: 50%;
  background: hsl(var(--h) 92% 64%);
  box-shadow: 0 0 7px 1px hsl(var(--h) 92% 64% / .85);
  animation: ns-ingress 2.2s cubic-bezier(.5,.02,.3,1) infinite;
  animation-delay: calc(var(--i) * -.275s);
}

/* core — the neuron. Absorbs each token with a pulse and a shockwave. */
.ns-core {
  position: absolute; width: 21%; height: 21%; border-radius: 50%;
  background: radial-gradient(circle at 36% 32%, #fff 4%,
    color-mix(in srgb, var(--ns-accent) 78%, #fff) 42%, var(--ns-accent) 100%);
  box-shadow: 0 0 13px 2px color-mix(in srgb, var(--ns-accent) 62%, transparent);
  animation: ns-core 1.1s ease-in-out infinite;
}
.ns-halo {
  position: absolute; width: 21%; height: 21%; border-radius: 50%;
  border: 1.5px solid var(--ns-accent);
  animation: ns-halo 1.1s ease-out infinite;
}

@keyframes ns-spin    { to { transform: rotate(360deg); } }
@keyframes ns-breathe { 0%,100% { opacity: .55; transform: scale(.94); }
                        50%     { opacity: .95; transform: scale(1.04); } }
@keyframes ns-ingress {
  0%   { transform: translateX(calc(var(--ns-size) * .43)) scale(.15); opacity: 0; }
  14%  { opacity: 1; }
  70%  { transform: translateX(calc(var(--ns-size) * .11)) scale(1);   opacity: 1; }
  90%  { transform: translateX(0) scale(.28); opacity: 0; }
  100% { transform: translateX(0) scale(.15); opacity: 0; }
}
@keyframes ns-wire  { 0%,100% { opacity: .12; } 62% { opacity: .85; } }
@keyframes ns-core  { 0%,100% { transform: scale(1); }   52% { transform: scale(1.22); } }
@keyframes ns-halo  { 0%   { transform: scale(1);   opacity: .75; }
                      100% { transform: scale(2.9); opacity: 0; } }

/* Reduced motion means motion stops. The identity survives as a static figure:
   the spectrum ring of tokens around a lit core, no rotation, no pulsing. */
@media (prefers-reduced-motion: reduce) {
  .ns::before, .ns-sweep, .ns-ticks, .ns-core, .ns-halo,
  .ns-spoke::before, .ns-spoke::after { animation: none; }
  .ns-spoke::before { transform: translateX(calc(var(--ns-size) * .32)); opacity: .9; }
  .ns-spoke::after  { opacity: .3; }
  .ns-halo { opacity: .3; }
}
`;

function useInjectedStyles() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement("style");
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
}

export default function NeuralSpinner({
  size = 96,
  className = "",
}) {
  useInjectedStyles();

  return (
    <div
      className={`ns ${className}`.trim()}
      style={{ "--ns-size": `${size}px` }}
      aria-hidden="true"
    >
      <div className="ns-sweep" />
      <div className="ns-ticks" />
      {TOKEN_HUES.map((h, i) => (
        <div key={h} className="ns-spoke" style={{ "--i": i, "--h": h }} />
      ))}
      <span className="ns-halo" />
      <span className="ns-core" />
    </div>
  );
}
