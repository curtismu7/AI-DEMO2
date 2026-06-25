import { useEffect, useRef, useState } from "react";

/* -------------------------------------------------------------------------- *
 *  BusySpinner — "telemetry sweep" loading indicator
 * -------------------------------------------------------------------------- *
 *  An instrument-panel radar that conveys the app is actively scanning while
 *  busy: a phosphor beam sweep over concentric counter-rotating rings, orbiting
 *  satellite blips, gauge ticks, a pulsing signal core, and a monospaced status
 *  readout with a blinking cursor.
 *
 *  Props
 *  -----
 *  size        number   diameter of the instrument face in px            (96)
 *  label       string   static status text shown beneath the dial        (null)
 *  messages    string[] cycled status text (overrides `label` if both)   ([])
 *  interval    number   ms between cycled messages                       (1800)
 *  accent      string   any CSS color — drives the whole phosphor theme  (#3ee6c4)
 *  theme       string   "dark" (luminous) | "light" (debossed instrument) ("dark")
 *  fullscreen  boolean  render as a centered, backdrop-blurred overlay   (false)
 *  className   string   extra class on the root for positioning          ("")
 * -------------------------------------------------------------------------- */

const STYLE_ID = "busy-spinner-styles";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

@keyframes bsp-sweep   { to { transform: rotate(360deg); } }
@keyframes bsp-counter { to { transform: rotate(-360deg); } }
@keyframes bsp-core {
  0%, 100% { transform: scale(1);    opacity: .9; }
  50%      { transform: scale(1.55); opacity: .35; }
}
@keyframes bsp-corehalo {
  0%, 100% { transform: scale(.7); opacity: .55; }
  50%      { transform: scale(1.9); opacity: 0; }
}
@keyframes bsp-blip {
  0%, 100% { opacity: 1;  box-shadow: 0 0 6px 1px var(--bsp-glow); }
  50%      { opacity: .4; box-shadow: 0 0 2px 0   var(--bsp-glow); }
}
@keyframes bsp-cursor { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes bsp-reveal {
  from { transform: scale(.82); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}
@keyframes bsp-overlay-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes bsp-dots {
  0%   { content: ""; }
  25%  { content: "."; }
  50%  { content: ".."; }
  75%  { content: "..."; }
  100% { content: ""; }
}

.bsp-overlay {
  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center;
  background:
    radial-gradient(120% 120% at 50% 40%, rgba(8,14,20,.62), rgba(2,4,7,.9)),
    rgba(2,4,7,.55);
  backdrop-filter: blur(7px) saturate(118%);
  -webkit-backdrop-filter: blur(7px) saturate(118%);
  animation: bsp-overlay-in .35s ease both;
}
.bsp-overlay--light {
  background:
    radial-gradient(120% 120% at 50% 40%, rgba(246,249,251,.58), rgba(223,231,236,.86)),
    rgba(233,239,243,.5);
}

.bsp-root {
  /* theme tokens — dark by default; remapped under [data-theme="light"] */
  --bsp-line:  var(--bsp-accent);
  --bsp-glow:  var(--bsp-accent);
  --bsp-dim:   color-mix(in srgb, var(--bsp-accent) 28%, transparent);
  --bsp-faint: color-mix(in srgb, var(--bsp-accent) 12%, transparent);
  --bsp-text:  color-mix(in srgb, var(--bsp-accent) 80%, white 20%);
  --bsp-face:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--bsp-accent) 9%, transparent) 0%, transparent 62%),
    radial-gradient(circle at 50% 50%, rgba(3,8,11,.9) 0%, rgba(3,6,9,.55) 70%, transparent 100%);
  --bsp-face-shadow:
    inset 0 0 calc(var(--bsp-size)*.18) rgba(0,0,0,.65),
    inset 0 0 0 1px var(--bsp-faint),
    0 0 calc(var(--bsp-size)*.28) var(--bsp-dim);
  --bsp-core-shadow: 0 0 calc(var(--bsp-size)*.12) var(--bsp-accent);

  display: inline-flex; flex-direction: column; align-items: center;
  gap: calc(var(--bsp-size) * .19);
  user-select: none;
  font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}

.bsp-root[data-theme="light"] {
  --bsp-line:  color-mix(in srgb, var(--bsp-accent) 70%, #0a2620 30%);
  --bsp-glow:  color-mix(in srgb, var(--bsp-accent) 76%, #07231d 24%);
  --bsp-dim:   color-mix(in srgb, var(--bsp-accent) 42%, transparent);
  --bsp-faint: color-mix(in srgb, var(--bsp-accent) 22%, transparent);
  --bsp-text:  color-mix(in srgb, var(--bsp-accent) 42%, #122f29 58%);
  --bsp-face:
    radial-gradient(circle at 50% 36%, #ffffff 0%, #eef3f5 68%, #e1e9ed 100%);
  --bsp-face-shadow:
    inset 0 1px calc(var(--bsp-size)*.05) rgba(255,255,255,.95),
    inset 0 0 calc(var(--bsp-size)*.14) rgba(20,40,52,.14),
    inset 0 0 0 1px color-mix(in srgb, var(--bsp-line) 22%, transparent),
    0 calc(var(--bsp-size)*.03) calc(var(--bsp-size)*.17) rgba(20,40,55,.18);
  --bsp-core-shadow: 0 0 calc(var(--bsp-size)*.07) color-mix(in srgb, var(--bsp-line) 55%, transparent);
}

.bsp-stage {
  position: relative;
  width: var(--bsp-size); height: var(--bsp-size);
  border-radius: 50%;
  display: grid; place-items: center;
  animation: bsp-reveal .5s cubic-bezier(.2,.9,.25,1) both;
  background: var(--bsp-face);
  box-shadow: var(--bsp-face-shadow);
}

/* gauge ticks around the rim */
.bsp-ticks {
  position: absolute; inset: 0; border-radius: 50%;
  background:
    repeating-conic-gradient(from 0deg,
      var(--bsp-dim) 0deg 1.1deg,
      transparent 1.1deg 7.5deg);
  -webkit-mask: radial-gradient(circle, transparent calc(50% - 5px), #000 calc(50% - 5px));
          mask: radial-gradient(circle, transparent calc(50% - 5px), #000 calc(50% - 5px));
  opacity: .8;
}

/* concentric rings */
.bsp-ring {
  position: absolute; border-radius: 50%;
  border: 1.5px solid transparent;
}
.bsp-ring--outer {
  inset: 9%;
  border-top-color: var(--bsp-line);
  border-right-color: color-mix(in srgb, var(--bsp-line) 45%, transparent);
  animation: bsp-sweep 2.6s linear infinite;
}
.bsp-ring--mid {
  inset: 26%;
  border-bottom-color: color-mix(in srgb, var(--bsp-line) 70%, transparent);
  border-left-color: color-mix(in srgb, var(--bsp-line) 30%, transparent);
  animation: bsp-counter 1.9s cubic-bezier(.7,0,.3,1) infinite;
}

/* satellite blips ride the rings */
.bsp-sat {
  position: absolute; top: -3.5px; left: 50%;
  width: 6px; height: 6px; margin-left: -3px;
  border-radius: 50%; background: var(--bsp-glow);
  animation: bsp-blip 1.3s ease-in-out infinite;
}
.bsp-ring--mid .bsp-sat { width: 4px; height: 4px; margin-left: -2px; top: -2.5px; animation-duration: 1s; }

/* the radar beam sweep — signature element */
.bsp-beam {
  position: absolute; inset: 5%; border-radius: 50%;
  background: conic-gradient(from 0deg,
    color-mix(in srgb, var(--bsp-line) 60%, transparent) 0deg,
    color-mix(in srgb, var(--bsp-line) 14%, transparent) 32deg,
    transparent 95deg,
    transparent 360deg);
  -webkit-mask: radial-gradient(circle, transparent 18%, #000 18.5%);
          mask: radial-gradient(circle, transparent 18%, #000 18.5%);
  animation: bsp-sweep 1.45s linear infinite;
  filter: drop-shadow(0 0 calc(var(--bsp-size)*.04) var(--bsp-dim));
}

/* pulsing signal core */
.bsp-core {
  position: relative;
  width: calc(var(--bsp-size)*.085); height: calc(var(--bsp-size)*.085);
  border-radius: 50%; background: var(--bsp-glow);
  box-shadow: var(--bsp-core-shadow);
  animation: bsp-core 1.45s ease-in-out infinite;
}
.bsp-core::after {
  content: ""; position: absolute; inset: -40%;
  border-radius: 50%;
  border: 1px solid var(--bsp-line);
  animation: bsp-corehalo 1.45s ease-out infinite;
}

/* status readout */
.bsp-label {
  display: inline-flex; align-items: center;
  font-size: clamp(10px, calc(var(--bsp-size)*.135), 15px);
  font-weight: 500; letter-spacing: .22em; text-transform: uppercase;
  color: var(--bsp-text);
  text-shadow: 0 0 12px var(--bsp-dim);
  white-space: nowrap;
}
.bsp-label::after {                 /* animated ellipsis */
  content: ""; width: 1.6em; text-align: left; margin-left: .1em;
  animation: bsp-dots 1.6s steps(1) infinite;
}
.bsp-cursor {
  display: inline-block; width: .58em; height: 1.05em; margin-left: .12em;
  background: var(--bsp-line); box-shadow: 0 0 8px var(--bsp-dim);
  animation: bsp-cursor 1.05s steps(1) infinite;
}

@media (prefers-reduced-motion: reduce) {
  .bsp-ring, .bsp-beam, .bsp-sat, .bsp-stage, .bsp-overlay { animation: none !important; }
  .bsp-core   { animation: bsp-core 2.4s ease-in-out infinite; }
  .bsp-cursor { animation: bsp-cursor 1.4s steps(1) infinite; }
  .bsp-label::after { animation: none; content: "…"; }
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

export default function BusySpinner({
  size = 96,
  label = null,
  messages = [],
  interval = 1800,
  accent = "#3ee6c4",
  theme = "dark",
  fullscreen = false,
  className = "",
}) {
  useInjectedStyles();

  const cycling = Array.isArray(messages) && messages.length > 0;
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);

  useEffect(() => {
    if (!cycling || messages.length < 2) return;
    const id = setInterval(() => {
      idxRef.current = (idxRef.current + 1) % messages.length;
      setIdx(idxRef.current);
    }, interval);
    return () => clearInterval(id);
  }, [cycling, messages.length, interval]);

  const text = cycling ? messages[idx] : label;

  const dial = (
    <div
      className={`bsp-root ${className}`}
      data-theme={theme}
      style={{ "--bsp-size": `${size}px`, "--bsp-accent": accent }}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={text || "Loading"}
    >
      <div className="bsp-stage">
        <div className="bsp-ticks" />
        <div className="bsp-ring bsp-ring--outer"><span className="bsp-sat" /></div>
        <div className="bsp-ring bsp-ring--mid"><span className="bsp-sat" /></div>
        <div className="bsp-beam" />
        <div className="bsp-core" />
      </div>
      {text != null && (
        <div className="bsp-label">
          {text}
          <span className="bsp-cursor" aria-hidden="true" />
        </div>
      )}
    </div>
  );

  if (fullscreen) {
    return <div className={`bsp-overlay${theme === "light" ? " bsp-overlay--light" : ""}`}>{dial}</div>;
  }
  return dial;
}
