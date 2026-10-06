// demoArchPrimitives.jsx — small SVG marks shared by the Demo arch slides.

export function Dots({ x, y }) {
  return (
    <>
      <circle cx={x + 12} cy={y + 10} r="2" className="das-cur" />
      <circle cx={x + 20} cy={y + 10} r="2" className="das-cur" />
      <circle cx={x + 28} cy={y + 10} r="2" className="das-cur" />
    </>
  );
}

export function Win({ x, y, w, h, title, sub, titleClass = "das-b" }) {
  const cx = x + w / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="6" className="das-outline" />
      <Dots x={x} y={y} />
      <text x={cx} y={y + 31} textAnchor="middle" className={`${titleClass} das-fs12`}>{title}</text>
      <text x={cx} y={y + 48} textAnchor="middle" className="das-s">{sub}</text>
    </g>
  );
}

export function Robot({ x, y }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <line x1="22" y1="0" x2="22" y2="8" className="das-ico" />
      <circle cx="22" cy="-2" r="2.5" className="das-cur" />
      <rect x="0" y="8" width="44" height="34" rx="7" className="das-ico" />
      <circle cx="14" cy="24" r="3.5" className="das-cur" />
      <circle cx="30" cy="24" r="3.5" className="das-cur" />
      <line x1="14" y1="34" x2="30" y2="34" className="das-ico" />
    </g>
  );
}

/** Card with a bold title and a muted one-line subtitle. */
export function Card({ x, y, w, h, title, sub, cls = "das-outline", children }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" className={cls} />
      <text x={x + 14} y={y + 24} className="das-b das-fs14">{title}</text>
      {sub && <text x={x + 14} y={y + 40} className="das-s">{sub}</text>}
      {children}
    </g>
  );
}

/** Small filled chip used for the lists inside a Card. */
export function Chip({ x, y, w, text, h = 22 }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="4" className="das-chip" />
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" className="das-fs11 das-chip-ink">{text}</text>
    </g>
  );
}
